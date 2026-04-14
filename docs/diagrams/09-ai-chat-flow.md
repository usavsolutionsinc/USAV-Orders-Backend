# 09 — AI Chat Flow (Hermes-backed)

The `/ai` page talks to a local Hermes gateway at `127.0.0.1:8642`. Three resolution paths — local-ops → NemoClaw RAG → Hermes LLM — are tried in sequence.

## End-to-end sequence

```mermaid
sequenceDiagram
    autonumber
    participant U as /ai page
    participant S as POST /api/ai/openclaw-session
    participant C as POST /api/ai/openclaw-chat
    participant DB as Neon<br/>ai_chat_sessions<br/>ai_chat_messages
    participant LO as resolveLocalAiAnswer()
    participant RAG as queryNemoClawRag()
    participant HG as Hermes gateway<br/>127.0.0.1:8642
    participant HDB as ~/.hermes-usav/state.db

    U->>S: (page load)
    S-->>U: { session_id: UUID }

    U->>C: { sessionId, message }

    par persist user message (fire-and-forget)
        C->>DB: INSERT ai_chat_messages<br/>(role='user', session_id)
    and intent detection
        C->>C: detectIntents() + extractParams()
    end

    C->>LO: try local-ops resolution
    alt local ops hit (e.g. "where is SKU X?")
        LO->>DB: deterministic Neon query
        LO-->>C: { reply, mode='local_ops', analysis }
    else bose_manual intent
        C->>RAG: queryNemoClawRag(intent, params)
        RAG-->>C: { chunks[], sources[] }
        C->>HG: POST /v1/chat/completions<br/>X-Hermes-Session-Id: sessionId<br/>msg + RAG context
        HG->>HDB: persist turn in state.db
        HG-->>C: { reply } (mode='rag' or 'hybrid')
    else general query
        C->>HG: POST /v1/chat/completions<br/>X-Hermes-Session-Id<br/>msg (no extra context)
        HG->>HDB: persist turn in state.db
        HG-->>C: { reply } (mode='assistant')
    end

    C->>DB: INSERT ai_chat_messages<br/>(role='assistant', mode, analysis?)
    C-->>U: { reply, sessionId, mode, analysis? }
```

## Resolution modes (returned as `mode` field)

```mermaid
graph TB
    MSG[User message] --> INTENT{detectIntents}

    INTENT -->|local-ops pattern| LOCAL[mode: local_ops<br/>direct Neon query, no LLM]
    INTENT -->|bose_manual| RAG_ONLY[mode: rag<br/>RAG only, no LLM]
    INTENT -->|manual + general| HYBRID[mode: hybrid<br/>RAG chunks + Hermes LLM]
    INTENT -->|general| ASST[mode: assistant<br/>Hermes LLM only]

    classDef fast fill:#059669,color:#fff
    classDef slow fill:#7c3aed,color:#fff
    class LOCAL,RAG_ONLY fast
    class HYBRID,ASST slow
```

Green = no LLM round-trip (fastest). Purple = Hermes invoked.

## Rate limiting & config

- **Rate limit:** 25 requests / 60s per IP. Env override: `AI_CHAT_RATE_LIMIT`.
- **Hermes endpoint:** `HERMES_URL` env (default `http://127.0.0.1:8642/v1/chat/completions`).
- **Session header:** `X-Hermes-Session-Id` — Hermes uses this to key its own conversation cache in `state.db`.
- **Model:** `hermes-agent` (NousResearch's Hermes, OpenAI-compatible server).

## Persistence

| Store | Purpose |
|---|---|
| `ai_chat_sessions` (Neon) | Session index — id (text, client UUID), title, timestamps |
| `ai_chat_messages` (Neon) | Full transcript — role, content, mode, analysis (jsonb) |
| `~/.hermes-usav/state.db` (SQLite, local) | Hermes's own short-term conversational memory keyed by session_id |

Dual persistence is intentional: Neon is the **system of record** (survives restarts, queryable from UI). Hermes's state.db is an **ephemeral cache** so the LLM keeps context across turns without re-reading Neon.

## Fetching history

```mermaid
graph LR
    UI[/ai sidebar]
    UI -->|list recent| L[GET /api/ai/chat-sessions<br/>returns 30 most recent]
    UI -->|open session| M[GET /api/ai/chat-sessions/&#91;sessionId&#93;/messages<br/>ordered by createdAt ASC]
    UI -->|delete| D[DELETE /api/ai/chat-sessions?id=...]
```

## Deprecated

`POST /api/ai/tunnel-session` — route retained for compatibility only. Hermes replaced the tunnel model. Comment: `src/app/api/ai/openclaw-chat/route.ts:1-5`.

## Key files

| Area | File |
|---|---|
| Chat orchestrator | `src/app/api/ai/openclaw-chat/route.ts:27-229` |
| Session create | `src/app/api/ai/openclaw-session/route.ts:11-13` |
| Schema | `src/lib/drizzle/schema.ts:1278-1298` |
| Session list/delete | `src/app/api/ai/chat-sessions/route.ts` |
| Session messages | `src/app/api/ai/chat-sessions/[sessionId]/messages/route.ts` |
