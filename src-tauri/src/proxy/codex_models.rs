//! Official model discovery keeps the caller's identity and applies only explicit user overrides.

use super::{server::ProxyState, ProxyError};
use crate::provider::Provider;
use futures::StreamExt;
use http::{HeaderMap, Uri};
use serde_json::Value;
use std::time::Duration;

pub(super) const ULTRA_EFFORT_SETTING: &str = "codex_ultra_reasoning_effort";
const MAX_CATALOG_BYTES: usize = 16 * 1024 * 1024;

pub(super) fn should_fetch_official_catalog(
    config_text: &str,
    provider: &Provider,
) -> Result<bool, ProxyError> {
    if !super::providers::is_codex_official_provider(provider) {
        return Ok(false);
    }
    let config = config_text.parse::<toml_edit::DocumentMut>().map_err(|_| {
        ProxyError::ConfigError("无法解析 Codex 配置，未请求官方模型目录".to_string())
    })?;
    Ok(!config.contains_key("model_catalog_json"))
}

pub(super) async fn official_catalog(
    state: &ProxyState,
    provider: &Provider,
    uri: &Uri,
    headers: &HeaderMap,
) -> Result<Value, ProxyError> {
    super::forwarder::validate_codex_official_request(headers, provider, state.app_handle.as_ref())
        .await?;
    let preference = state
        .db
        .get_setting(ULTRA_EFFORT_SETTING)
        .map_err(|error| ProxyError::DatabaseError(error.to_string()))?;
    let ultra_max = match preference.as_deref() {
        None => false,
        Some("max") => true,
        Some(_) => {
            return Err(ProxyError::ConfigError(
                "codex_ultra_reasoning_effort 仅支持 max，删除此设置可恢复官方默认值".to_string(),
            ))
        }
    };
    let client = super::http_client::get_without_redirects().map_err(ProxyError::ConfigError)?;
    fetch_catalog(
        &client,
        crate::services::codex_oauth_models::CODEX_OAUTH_MODELS_URL,
        uri,
        headers,
        ultra_max,
    )
    .await
}

fn apply_ultra_max(catalog: &mut Value, enabled: bool) {
    if !enabled {
        return;
    }
    let Some(models) = catalog.get_mut("models").and_then(Value::as_array_mut) else {
        return;
    };
    for model in models {
        let supports = |effort: &str| {
            model
                .get("supported_reasoning_levels")
                .and_then(Value::as_array)
                .is_some_and(|levels| {
                    levels
                        .iter()
                        .any(|level| level.get("effort").and_then(Value::as_str) == Some(effort))
                })
        };
        if supports("ultra") && supports("max") {
            model["multi_agent_reasoning_effort"] = Value::String("max".to_string());
        }
    }
}

async fn fetch_catalog(
    client: &reqwest::Client,
    endpoint: &str,
    uri: &Uri,
    headers: &HeaderMap,
    ultra_max: bool,
) -> Result<Value, ProxyError> {
    if super::forwarder::codex_bearer_access_token(headers)
        .filter(|token| !token.contains("PROXY_MANAGED"))
        .is_none()
    {
        return Err(ProxyError::AuthError(
            "获取官方模型目录需要当前 Codex 的 ChatGPT 登录".to_string(),
        ));
    }
    if !url::form_urlencoded::parse(uri.query().unwrap_or_default().as_bytes())
        .any(|(name, value)| name == "client_version" && !value.trim().is_empty())
    {
        return Err(ProxyError::InvalidRequest(
            "获取官方模型目录缺少 client_version".to_string(),
        ));
    }
    let mut url = reqwest::Url::parse(endpoint)
        .map_err(|_| ProxyError::ConfigError("官方模型目录地址无效".to_string()))?;
    url.set_query(uri.query());
    let mut request = client
        .get(url)
        .header(http::header::ACCEPT, "application/json")
        .header(http::header::ACCEPT_ENCODING, "identity")
        .timeout(Duration::from_secs(10));
    // 仅传当前请求的必要身份；不复用其他账号缓存，也不转发 Cookie 或条件缓存头。
    for name in [
        "authorization",
        "chatgpt-account-id",
        "user-agent",
        "originator",
    ] {
        if let Some(value) = headers.get(name) {
            request = request.header(name, value);
        }
    }
    let response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            ProxyError::Timeout("获取官方模型目录超时".to_string())
        } else {
            ProxyError::ForwardFailed("获取官方模型目录失败".to_string())
        }
    })?;
    let status = response.status();
    if status.is_redirection() {
        return Err(ProxyError::ForwardFailed(
            "官方模型目录返回重定向，未转发登录凭据".to_string(),
        ));
    }
    if !status.is_success() {
        return Err(ProxyError::UpstreamError {
            status: status.as_u16(),
            body: None,
        });
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|_| ProxyError::ForwardFailed("读取官方模型目录失败".to_string()))?;
        if body.len().saturating_add(chunk.len()) > MAX_CATALOG_BYTES {
            return Err(ProxyError::ResponseBodyTooLarge(MAX_CATALOG_BYTES));
        }
        body.extend_from_slice(&chunk);
    }
    let mut catalog: Value = serde_json::from_slice(&body)
        .map_err(|_| ProxyError::ForwardFailed("官方模型目录不是有效 JSON".to_string()))?;
    if !catalog.get("models").is_some_and(Value::is_array) {
        return Err(ProxyError::ForwardFailed(
            "官方模型目录缺少 models 数组".to_string(),
        ));
    }
    apply_ultra_max(&mut catalog, ultra_max);
    Ok(catalog)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::OriginalUri, response::IntoResponse, routing::get, Json, Router};
    use http::StatusCode;
    use serde_json::json;

    #[test]
    fn only_official_routes_without_a_local_catalog_use_remote_discovery() {
        let mut provider = crate::provider::Provider::with_id(
            crate::database::CODEX_OFFICIAL_PROVIDER_ID.to_string(),
            "Official".to_string(),
            json!({}),
            None,
        );
        provider.category = Some("official".to_string());
        assert!(should_fetch_official_catalog("model = \"gpt-6.2-sol\"", &provider).unwrap());
        assert!(
            !should_fetch_official_catalog("model_catalog_json = \"custom.json\"", &provider)
                .unwrap()
        );
        assert!(should_fetch_official_catalog("invalid = [", &provider).is_err());
        provider.id = "third-party".to_string();
        provider.category = None;
        assert!(!should_fetch_official_catalog("", &provider).unwrap());
    }

    fn catalog() -> Value {
        json!({"models": [
            {"slug":"gpt-6.2-sol", "multi_agent_reasoning_effort":"xhigh",
             "supported_reasoning_levels":[{"effort":"max"},{"effort":"ultra"}],
             "model_messages":{"instructions_template":"preserve official instructions"}},
            {"slug":"future-model", "multi_agent_reasoning_effort":"xhigh",
             "supported_reasoning_levels":[{"effort":"max"},{"effort":"ultra"}],
             "future_metadata":{"keep":true}},
            {"slug":"without-ultra", "supported_reasoning_levels":[{"effort":"max"}]},
            {"slug":"without-max", "supported_reasoning_levels":[{"effort":"ultra"},{"effort":"high"}]}
        ],"future_catalog_field":42})
    }

    fn headers() -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("authorization", "Bearer caller-token".parse().unwrap());
        h.insert("chatgpt-account-id", "caller-workspace".parse().unwrap());
        h.insert("cookie", "must-not-forward=this".parse().unwrap());
        h
    }

    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap()
    }

    async fn serve(router: Router) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/models", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        (endpoint, task)
    }

    #[test]
    fn ultra_override_preserves_new_models_and_all_other_metadata() {
        let original = catalog();
        let mut actual = original.clone();
        apply_ultra_max(&mut actual, true);
        assert_eq!(actual["models"][0]["multi_agent_reasoning_effort"], "max");
        assert_eq!(actual["models"][1]["multi_agent_reasoning_effort"], "max");
        actual["models"][0]["multi_agent_reasoning_effort"] = json!("xhigh");
        actual["models"][1]["multi_agent_reasoning_effort"] = json!("xhigh");
        assert_eq!(actual, original);
    }

    #[test]
    fn no_override_keeps_official_defaults() {
        let original = catalog();
        let mut actual = original.clone();
        apply_ultra_max(&mut actual, false);
        assert_eq!(actual, original);
    }

    #[tokio::test]
    async fn discovery_uses_request_identity_and_version_and_returns_new_models() {
        let router = Router::new().route(
            "/models",
            get(|OriginalUri(uri): OriginalUri, h: HeaderMap| async move {
                if h.get("authorization").and_then(|v| v.to_str().ok())
                    != Some("Bearer caller-token")
                    || h.get("chatgpt-account-id").and_then(|v| v.to_str().ok())
                        != Some("caller-workspace")
                    || uri.query() != Some("client_version=0.169.0")
                    || h.contains_key("cookie")
                {
                    return StatusCode::UNAUTHORIZED.into_response();
                }
                Json(catalog()).into_response()
            }),
        );
        let (url, server) = serve(router).await;
        let result = fetch_catalog(
            &client(),
            &url,
            &"/v1/models?client_version=0.169.0".parse().unwrap(),
            &headers(),
            true,
        )
        .await;
        server.abort();
        let actual = result.unwrap();
        assert_eq!(actual["models"].as_array().unwrap().len(), 4);
        assert_eq!(actual["models"][1]["slug"], "future-model");
        assert_eq!(actual["models"][0]["multi_agent_reasoning_effort"], "max");
    }

    #[tokio::test]
    async fn upstream_rejection_remains_an_error_instead_of_an_empty_catalog() {
        let (url, server) =
            serve(Router::new().route("/models", get(|| async { StatusCode::UNAUTHORIZED }))).await;
        let result = fetch_catalog(
            &client(),
            &url,
            &"/models?client_version=0.169.0".parse().unwrap(),
            &headers(),
            false,
        )
        .await;
        server.abort();
        assert!(matches!(
            result,
            Err(ProxyError::UpstreamError { status: 401, .. })
        ));
    }

    #[tokio::test]
    async fn discovery_requires_the_callers_bearer_token() {
        let result = fetch_catalog(
            &client(),
            "http://127.0.0.1:1/models",
            &"/models".parse().unwrap(),
            &HeaderMap::new(),
            false,
        )
        .await;
        assert!(matches!(result, Err(ProxyError::AuthError(_))));
    }

    #[tokio::test]
    async fn malformed_catalog_and_redirects_are_reported_as_errors() {
        for (status, body) in [
            (StatusCode::OK, json!({"data":[]})),
            (StatusCode::FOUND, json!({})),
        ] {
            let (url, server) = serve(Router::new().route(
                "/models",
                get(move || async move { (status, Json(body.clone())) }),
            ))
            .await;
            let result = fetch_catalog(
                &client(),
                &url,
                &"/models?client_version=0.169.0".parse().unwrap(),
                &headers(),
                false,
            )
            .await;
            server.abort();
            assert!(matches!(result, Err(ProxyError::ForwardFailed(_))));
        }
    }
}
