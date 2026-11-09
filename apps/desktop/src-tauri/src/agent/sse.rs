use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Clone)]
pub enum SseEvent {
    ReasoningDelta(String),
    ContentDelta(String),
    ToolCallDelta {
        index: usize,
        id: Option<String>,
        name: Option<String>,
        arguments_delta: Option<String>,
    },
    FinishReason(Option<String>),
    Usage {
        prompt_tokens: Option<u64>,
        completion_tokens: Option<u64>,
        total_tokens: Option<u64>,
    },
    Done,
    Error(String),
}

#[derive(Deserialize)]
struct StreamChunk {
    choices: Option<Vec<StreamChoice>>,
    usage: Option<StreamUsage>,
}

#[derive(Deserialize)]
struct StreamChoice {
    delta: Option<StreamDelta>,
    finish_reason: Option<Value>,
}

#[derive(Deserialize)]
struct StreamDelta {
    content: Option<String>,
    reasoning_content: Option<String>,
    tool_calls: Option<Vec<ToolCallDelta>>,
}

#[derive(Deserialize)]
struct ToolCallDelta {
    index: Option<usize>,
    id: Option<String>,
    function: Option<ToolFunctionDelta>,
}

#[derive(Deserialize)]
struct ToolFunctionDelta {
    name: Option<String>,
    arguments: Option<String>,
}

#[derive(Deserialize)]
struct StreamUsage {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    total_tokens: Option<u64>,
}

pub struct SseParser {
    buffer: String,
}

impl SseParser {
    pub fn new() -> Self {
        Self {
            buffer: String::new(),
        }
    }

    pub fn push_bytes(&mut self, bytes: &[u8]) -> Vec<SseEvent> {
        self.buffer.push_str(&String::from_utf8_lossy(bytes));
        if self.buffer.contains('\r') {
            self.buffer = self.buffer.replace("\r\n", "\n").replace('\r', "\n");
        }
        self.drain()
    }

    pub fn finish(&mut self) -> Vec<SseEvent> {
        let mut events = Vec::new();
        if !self.buffer.is_empty() {
            let remaining = std::mem::take(&mut self.buffer);
            for line in remaining.lines() {
                events.extend(self.parse_line(line));
            }
        }
        events
    }

    fn drain(&mut self) -> Vec<SseEvent> {
        let mut events = Vec::new();
        while let Some(pos) = self.buffer.find("\n\n") {
            let block = self.buffer[..pos].to_string();
            self.buffer = self.buffer[pos + 2..].to_string();
            for line in block.lines() {
                events.extend(self.parse_line(line));
            }
        }
        events
    }

    fn parse_line(&mut self, line: &str) -> Vec<SseEvent> {
        let line = line.trim();
        if line.is_empty() || line.starts_with(':') {
            return Vec::new();
        }
        if !line.starts_with("data:") {
            return Vec::new();
        }
        let data = line.trim_start_matches("data:").trim();
        if data == "[DONE]" {
            return vec![SseEvent::Done];
        }
        let mut events = Vec::new();
        if let Ok(parsed) = serde_json::from_str::<StreamChunk>(data) {
            if let Some(usage) = parsed.usage {
                events.push(SseEvent::Usage {
                    prompt_tokens: usage.prompt_tokens,
                    completion_tokens: usage.completion_tokens,
                    total_tokens: usage.total_tokens,
                });
            }
            if let Some(choices) = parsed.choices {
                for choice in choices {
                    if let Some(reason) = choice.finish_reason {
                        let reason_str = match reason {
                            Value::String(s) => Some(s),
                            Value::Null => None,
                            _ => reason.as_str().map(|s| s.to_string()),
                        };
                        events.push(SseEvent::FinishReason(reason_str));
                    }
                    if let Some(delta) = choice.delta {
                        if let Some(rc) = delta.reasoning_content {
                            if !rc.is_empty() {
                                events.push(SseEvent::ReasoningDelta(rc));
                            }
                        }
                        if let Some(content) = delta.content {
                            if !content.is_empty() {
                                events.push(SseEvent::ContentDelta(content));
                            }
                        }
                        if let Some(tool_calls) = delta.tool_calls {
                            for tc in tool_calls {
                                let index = tc.index.unwrap_or(0);
                                events.push(SseEvent::ToolCallDelta {
                                    index,
                                    id: tc.id,
                                    name: tc.function.as_ref().and_then(|f| f.name.clone()),
                                    arguments_delta: tc
                                        .function
                                        .as_ref()
                                        .and_then(|f| f.arguments.clone()),
                                });
                            }
                        }
                    }
                }
            }
        }
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_crlf_and_batched_events() {
        let mut p = SseParser::new();
        let raw = "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"a\"}}]}\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"b\"}}]}\r\n\r\n";
        let ev = p.push_bytes(raw.as_bytes());
        assert!(matches!(ev[0], SseEvent::ReasoningDelta(ref s) if s == "a"));
        assert!(matches!(ev[1], SseEvent::ContentDelta(ref s) if s == "b"));
    }

    #[test]
    fn holds_incomplete_then_completes() {
        let mut p = SseParser::new();
        let first = p.push_bytes(b"data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]");
        assert!(first.is_empty());
        let second = p.push_bytes(b"}\n\n");
        assert!(matches!(second[0], SseEvent::ContentDelta(ref s) if s == "hi"));
    }

    #[test]
    fn ignores_comments_keepalive_and_done() {
        let mut p = SseParser::new();
        let raw = ": keep-alive\n\ndata: [DONE]\n\n";
        let ev = p.push_bytes(raw.as_bytes());
        assert!(matches!(ev.as_slice(), [SseEvent::Done]));
    }

    #[test]
    fn skips_role_only_and_empty_delta() {
        let mut p = SseParser::new();
        let raw = "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"\"}}]}\n\n";
        let ev = p.push_bytes(raw.as_bytes());
        assert!(ev.is_empty());
    }
}
