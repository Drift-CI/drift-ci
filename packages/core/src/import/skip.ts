export type TraceSkipReason =
  | 'invalid-json'
  | 'not-a-chat-trace'
  | 'non-text content'
  | 'system message mid-conversation'
  | 'no final assistant reply'
  | 'no user turn'
  | 'roles do not alternate'
  | 'empty content'
  | 'legacy function calls'
  | 'tool calls before the last user message'
  | 'final reply calls tools'
  | 'unanswered tool call'
  | 'invalid tool arguments'
  | 'invalid tool definitions'
  | 'too many tool steps';

/** Thrown inside the trace converters to stop with a skip reason. */
export class Skip extends Error {
  constructor(public readonly reason: TraceSkipReason) {
    super(reason);
  }
}
