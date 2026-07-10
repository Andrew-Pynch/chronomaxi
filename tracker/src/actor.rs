//! Parses the `cmx|` window-title attribution tag emitted by AttributionKit's
//! shell hook (deploy/attribution/**, outside this crate) so a span can be
//! attributed to the right actor/target even when it happens inside an ssh
//! session whose title was rewritten by the remote shell.
//!
//! Literal grammar (confirmed with AttributionKit over IRC):
//!   cmx|actor=<actor>|host=<hostname>|to=<target-or-dash>|sid=<8lowercasehex>
//! e.g. cmx|actor=agent:foo|host=big-ron|to=big-bertha|sid=a1b2c3d4

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CmxTag {
    pub actor: String,
    pub host: Option<String>,
    pub target: Option<String>,
    pub session_id: Option<String>,
}

/// Parses a `cmx|...` tagged window title. Returns `None` when the title
/// does not start with the `cmx|` prefix, or carries no `actor=` field.
pub fn parse_cmx_tag(title: &str) -> Option<CmxTag> {
    let rest = title.strip_prefix("cmx|")?;

    let mut actor: Option<String> = None;
    let mut host = None;
    let mut target = None;
    let mut session_id = None;

    for field in rest.split('|') {
        let Some((key, value)) = field.split_once('=') else {
            continue;
        };

        match key {
            "actor" => actor = Some(value.to_string()),
            "host" => host = Some(value.to_string()),
            "to" => target = Some(value.to_string()),
            "sid" => session_id = Some(value.to_string()),
            _ => {}
        }
    }

    actor.map(|actor| CmxTag { actor, host, target, session_id })
}

/// Resolves the actor to stamp on a span: the `cmx|actor=...` tag on the
/// window title wins when present, else the caller's configured fallback
/// (CHRONOMAXI_ACTOR, itself defaulting to "human").
pub fn resolve_actor(window_title: &str, fallback_actor: &str) -> String {
    match parse_cmx_tag(window_title) {
        Some(tag) if !tag.actor.is_empty() => tag.actor,
        _ => fallback_actor.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_tag() {
        let tag = parse_cmx_tag("cmx|actor=agent:foo|host=big-ron|to=big-bertha|sid=a1b2c3d4").unwrap();
        assert_eq!(tag.actor, "agent:foo");
        assert_eq!(tag.host.as_deref(), Some("big-ron"));
        assert_eq!(tag.target.as_deref(), Some("big-bertha"));
        assert_eq!(tag.session_id.as_deref(), Some("a1b2c3d4"));
    }

    #[test]
    fn parses_dash_target() {
        let tag = parse_cmx_tag("cmx|actor=human|host=big-ron|to=-|sid=deadbeef").unwrap();
        assert_eq!(tag.target.as_deref(), Some("-"));
    }

    #[test]
    fn non_tagged_title_is_none() {
        assert!(parse_cmx_tag("nvim ~/personal/chronomaxi/README.md").is_none());
    }

    #[test]
    fn resolve_falls_back_when_untagged() {
        assert_eq!(resolve_actor("some window title", "human"), "human");
    }

    #[test]
    fn resolve_uses_tag_actor_when_present() {
        assert_eq!(
            resolve_actor("cmx|actor=agent:probe|host=big-ron|to=-|sid=deadbeef", "human"),
            "agent:probe"
        );
    }
}
