import { randomUUID } from "node:crypto";
import { ChatSession } from "../../database/mongoose/models/ChatSessionModel.js";
import { isMongoReady } from "../../database/database.js";
import { toNamespacedThreadId, purgeUserCheckpoints } from "../checkpointer.js";
import { shortTermMemory } from "./shortTerm.js";

export interface ChatMessageRecord {
  id?: string;
  role: string;
  content: string;
  sources?: string[];
  toolStatus?: string[];
  actions?: unknown[];
  model?: string;
  tier?: number;
  status?: string;
  createdAt?: Date;
}

export interface ChatSessionPageContext {
  kind: string;
  id: string;
  label: string;
  [key: string]: unknown;
}

export interface ChatSessionRecord {
  _id?: unknown;
  userId: string;
  threadId: string;
  checkpointThreadId?: string;
  title: string;
  rollingSummary?: string;
  messages: ChatMessageRecord[];
  pageContext?: ChatSessionPageContext;
  lastStreamStatus?: string;
  retentionDays?: number;
  retentionExpiresAt?: Date | null;
  isDeleted?: boolean;
  lastMessageAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  [key: string]: unknown;
}

export interface SessionSummary {
  id: string;
  threadId: string;
  title: string;
  rollingSummary: string;
  messageCount: number;
  lastMessagePreview: string;
  lastStreamStatus: string;
  pageContext: ChatSessionPageContext;
  retentionDays: number;
  retentionExpiresAt: Date | null;
  lastMessageAt: Date | string | undefined;
  createdAt: Date | string | undefined;
  updatedAt: Date | string | undefined;
}

export interface SessionDetail extends SessionSummary {
  messages: ChatMessageRecord[];
}

const inMemorySessions = new Map<string, ChatSessionRecord>();

function sessionKey(userId: string | unknown, threadId: string | unknown): string {
  return `${String(userId)}:${String(threadId)}`;
}

export function deriveSessionTitle(prompt = ""): string {
  const clean = String(prompt || "")
    .replace(/\s+/g, " ")
    .replace(/[<>{}[\]]/g, "")
    .trim();
  if (!clean) return "New conversation";
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
}

export function buildIncrementalSummary(
  priorSummary = "",
  olderMessages: Array<{ role: string; content?: string }> = [],
): string {
  if (!olderMessages || olderMessages.length === 0) return priorSummary || "";
  const lines: string[] = [];
  if (priorSummary) lines.push(priorSummary.trim());
  for (const msg of olderMessages) {
    const roleLabel = msg.role === "assistant" ? "Assistant" : "User";
    const snippet = String(msg.content || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    if (snippet) lines.push(`${roleLabel}: ${snippet}`);
  }
  const combined = lines.join("\n");
  return combined.length > 1600 ? combined.slice(combined.length - 1600) : combined;
}

function serializeSessionSummary(doc?: ChatSessionRecord | null): SessionSummary | null {
  if (!doc) return null;
  const messages = Array.isArray(doc.messages) ? doc.messages : [];
  const lastMsg = messages[messages.length - 1];
  return {
    id: doc.threadId,
    threadId: doc.threadId,
    title: doc.title || "New conversation",
    rollingSummary: doc.rollingSummary || "",
    messageCount: messages.length,
    lastMessagePreview: lastMsg ? String(lastMsg.content || "").slice(0, 140) : "",
    lastStreamStatus: doc.lastStreamStatus || "idle",
    pageContext: doc.pageContext || { kind: "none", id: "", label: "" },
    retentionDays: doc.retentionDays || 90,
    retentionExpiresAt: doc.retentionExpiresAt || null,
    lastMessageAt: doc.lastMessageAt || doc.updatedAt || doc.createdAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function serializeSessionDetail(doc?: ChatSessionRecord | null): SessionDetail | null {
  if (!doc) return null;
  const summary = serializeSessionSummary(doc);
  if (!summary) return null;
  return {
    ...summary,
    messages: (doc.messages || []).map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      sources: msg.sources || [],
      toolStatus: msg.toolStatus || [],
      actions: msg.actions || [],
      model: msg.model || "",
      tier: msg.tier || 1,
      status: msg.status || "completed",
      createdAt: msg.createdAt,
    })),
  };
}

export const chatSessionService = {
  async getOrCreateSession(
    userId: string | unknown,
    threadId?: string | unknown,
    {
      title,
      retentionDays = 90,
      pageContext,
    }: { title?: string; retentionDays?: number; pageContext?: ChatSessionPageContext } = {},
  ): Promise<ChatSessionRecord> {
    const uid = String(userId);
    const tid = String(threadId || `th_${Date.now()}`)
      .trim()
      .slice(0, 120);
    const checkpointThreadId = toNamespacedThreadId(uid, tid);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + Math.max(1, Math.min(365, retentionDays)) * 86_400_000,
    );

    if (isMongoReady()) {
      const existing = (await ChatSession.findOne({
        userId: uid,
        threadId: tid,
        isDeleted: false,
      }).lean()) as unknown as ChatSessionRecord | null;
      if (existing) return existing;
      try {
        const created = (await ChatSession.findOneAndUpdate(
          { userId: uid, threadId: tid },
          {
            $set: {
              isDeleted: false,
              checkpointThreadId,
              retentionDays,
              retentionExpiresAt: expiresAt,
              ...(pageContext ? { pageContext } : {}),
            },
            $setOnInsert: {
              userId: uid,
              threadId: tid,
              title: title ? deriveSessionTitle(title) : "New conversation",
              rollingSummary: "",
              messages: [],
              lastStreamStatus: "idle",
              lastMessageAt: now,
            },
          },
          { upsert: true, new: true },
        ).lean()) as unknown as ChatSessionRecord;
        return created;
      } catch (err: unknown) {
        if ((err as { code?: number })?.code === 11000) {
          return (await ChatSession.findOne({
            userId: uid,
            threadId: tid,
          }).lean()) as unknown as ChatSessionRecord;
        }
        throw err;
      }
    }

    const key = sessionKey(uid, tid);
    let session = inMemorySessions.get(key);
    if (!session || session.isDeleted) {
      session = {
        _id: `sess_${randomUUID()}`,
        userId: uid,
        threadId: tid,
        checkpointThreadId,
        title: title ? deriveSessionTitle(title) : "New conversation",
        rollingSummary: "",
        messages: [],
        pageContext: pageContext || { kind: "none", id: "", label: "" },
        lastStreamStatus: "idle",
        retentionDays,
        retentionExpiresAt: expiresAt,
        isDeleted: false,
        lastMessageAt: now,
        createdAt: now,
        updatedAt: now,
      };
      inMemorySessions.set(key, session);
    }
    return session;
  },

  /**
   * Begin a user turn. If retrying a failed/cancelled turn with the same prompt,
   * replaces the failed trailing turn instead of duplicating the user message.
   */
  async beginTurn({
    userId,
    threadId,
    prompt,
    retentionDays = 90,
    pageContext = null,
    isRetry = false,
  }: {
    userId: string | unknown;
    threadId: string | unknown;
    prompt: string;
    retentionDays?: number;
    pageContext?: ChatSessionPageContext | null;
    isRetry?: boolean;
  }): Promise<ChatSessionRecord> {
    const uid = String(userId);
    const session = await this.getOrCreateSession(uid, threadId, {
      title: prompt,
      retentionDays,
      pageContext: pageContext || undefined,
    });
    const messages = [...(session.messages || [])];
    const last = messages[messages.length - 1];
    const secondLast = messages.length >= 2 ? messages[messages.length - 2] : null;

    if (
      isRetry ||
      (last &&
        (last.status === "failed" ||
          last.status === "cancelled" ||
          (last.role === "assistant" && !last.content.trim())))
    ) {
      if (last?.role === "assistant") messages.pop();
      const newLast = messages[messages.length - 1];
      if (newLast?.role === "user" && newLast?.content === prompt) {
        messages.pop();
      }
    } else if (last?.role === "user" && last.content === prompt && !secondLast) {
      messages.pop();
    }

    const userMsg: ChatMessageRecord = {
      id: `msg_${randomUUID()}`,
      role: "user",
      content: prompt,
      sources: [],
      toolStatus: [],
      actions: [],
      status: "completed",
      createdAt: new Date(),
    };
    messages.push(userMsg);

    // Maintain incremental rolling summary when messages exceed 12
    let rollingSummary = session.rollingSummary || "";
    let boundedMessages = messages;
    if (boundedMessages.length > 24) {
      const evicted = boundedMessages.slice(0, boundedMessages.length - 16);
      rollingSummary = buildIncrementalSummary(rollingSummary, evicted);
      boundedMessages = boundedMessages.slice(-16);
    }

    const nextTitle =
      !session.title || session.title === "New conversation"
        ? deriveSessionTitle(prompt)
        : session.title;
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + Math.max(1, Math.min(365, retentionDays)) * 86_400_000,
    );

    if (isMongoReady()) {
      const updated = (await ChatSession.findOneAndUpdate(
        { userId: uid, threadId: session.threadId },
        {
          $set: {
            title: nextTitle,
            messages: boundedMessages,
            rollingSummary,
            lastStreamStatus: "streaming",
            lastMessageAt: now,
            retentionDays,
            retentionExpiresAt: expiresAt,
            ...(pageContext ? { pageContext } : {}),
          },
        },
        { new: true },
      ).lean()) as unknown as ChatSessionRecord;
      await shortTermMemory.appendTurn(uid, session.threadId, "user", prompt);
      return updated;
    }

    session.title = nextTitle;
    session.messages = boundedMessages;
    session.rollingSummary = rollingSummary;
    session.lastStreamStatus = "streaming";
    session.lastMessageAt = now;
    session.updatedAt = now;
    if (pageContext) session.pageContext = pageContext;
    await shortTermMemory.appendTurn(uid, session.threadId, "user", prompt);
    return session;
  },

  async completeTurn({
    userId,
    threadId,
    content,
    sources = [],
    toolStatus = [],
    actions = [],
    model = "",
    tier = 1,
    status = "completed",
  }: {
    userId: string | unknown;
    threadId: string | unknown;
    content?: string;
    sources?: string[];
    toolStatus?: string[];
    actions?: unknown[];
    model?: string;
    tier?: number;
    status?: string;
  }): Promise<ChatSessionRecord> {
    const uid = String(userId);
    const session = await this.getOrCreateSession(uid, threadId);
    const messages = [...(session.messages || [])];
    const assistantMsg: ChatMessageRecord = {
      id: `msg_${randomUUID()}`,
      role: "assistant",
      content: String(content || ""),
      sources,
      toolStatus,
      actions,
      model,
      tier,
      status,
      createdAt: new Date(),
    };
    messages.push(assistantMsg);

    let rollingSummary = session.rollingSummary || "";
    if (messages.length > 8) {
      const older = messages.slice(-10, -6);
      rollingSummary = buildIncrementalSummary(rollingSummary, older);
    }

    const now = new Date();
    if (isMongoReady()) {
      const updated = (await ChatSession.findOneAndUpdate(
        { userId: uid, threadId: session.threadId },
        {
          $set: {
            messages,
            rollingSummary,
            lastStreamStatus: status,
            lastMessageAt: now,
          },
        },
        { new: true },
      ).lean()) as unknown as ChatSessionRecord;
      if (content) {
        await shortTermMemory.appendTurn(uid, session.threadId, "assistant", content);
      }
      return updated;
    }

    session.messages = messages;
    session.rollingSummary = rollingSummary;
    session.lastStreamStatus = status;
    session.lastMessageAt = now;
    session.updatedAt = now;
    if (content) {
      await shortTermMemory.appendTurn(uid, session.threadId, "assistant", content);
    }
    return session;
  },

  async listSessions(
    userId: string | unknown,
    { limit = 30 }: { limit?: number } = {},
  ): Promise<SessionSummary[]> {
    const uid = String(userId);
    if (isMongoReady()) {
      const docs = (await ChatSession.find({ userId: uid, isDeleted: false })
        .sort({ lastMessageAt: -1 })
        .limit(Math.min(100, Math.max(1, limit)))
        .lean()) as unknown as ChatSessionRecord[];
      return docs.map(serializeSessionSummary).filter((s): s is SessionSummary => s !== null);
    }
    const items = [...inMemorySessions.values()]
      .filter((s) => s.userId === uid && !s.isDeleted)
      .sort(
        (a, b) =>
          new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime(),
      )
      .slice(0, limit);
    return items.map(serializeSessionSummary).filter((s): s is SessionSummary => s !== null);
  },

  async getSession(
    userId: string | unknown,
    threadId: string | unknown,
  ): Promise<SessionDetail | null> {
    const uid = String(userId);
    const tid = String(threadId || "").trim();
    if (!tid) return null;
    if (isMongoReady()) {
      const doc = (await ChatSession.findOne({
        userId: uid,
        threadId: tid,
        isDeleted: false,
      }).lean()) as unknown as ChatSessionRecord | null;
      return serializeSessionDetail(doc);
    }
    const session = inMemorySessions.get(sessionKey(uid, tid));
    if (!session || session.isDeleted) return null;
    return serializeSessionDetail(session);
  },

  async renameSession(
    userId: string | unknown,
    threadId: string | unknown,
    title: string,
  ): Promise<SessionSummary | null> {
    const uid = String(userId);
    const tid = String(threadId || "").trim();
    const cleanTitle = deriveSessionTitle(title);
    if (isMongoReady()) {
      const updated = (await ChatSession.findOneAndUpdate(
        { userId: uid, threadId: tid, isDeleted: false },
        { $set: { title: cleanTitle } },
        { new: true },
      ).lean()) as unknown as ChatSessionRecord | null;
      return serializeSessionSummary(updated);
    }
    const session = inMemorySessions.get(sessionKey(uid, tid));
    if (!session || session.isDeleted) return null;
    session.title = cleanTitle;
    session.updatedAt = new Date();
    return serializeSessionSummary(session);
  },

  async deleteSession(userId: string | unknown, threadId: string | unknown): Promise<boolean> {
    const uid = String(userId);
    const tid = String(threadId || "").trim();
    await shortTermMemory.clearSession(uid, tid);
    await purgeUserCheckpoints(uid, tid);
    if (isMongoReady()) {
      const res = await ChatSession.deleteOne({ userId: uid, threadId: tid });
      return res.deletedCount > 0;
    }
    const key = sessionKey(uid, tid);
    const existed = inMemorySessions.has(key);
    inMemorySessions.delete(key);
    return existed;
  },

  async updateRetentionForUser(
    userId: string | unknown,
    retentionDays: number | string,
  ): Promise<number> {
    const uid = String(userId);
    const days = Math.max(1, Math.min(365, Number(retentionDays) || 90));
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    if (isMongoReady()) {
      await ChatSession.updateMany(
        { userId: uid, isDeleted: false },
        { $set: { retentionDays: days, retentionExpiresAt: expiresAt } },
      );
      return days;
    }
    for (const session of inMemorySessions.values()) {
      if (session.userId === uid) {
        session.retentionDays = days;
        session.retentionExpiresAt = expiresAt;
      }
    }
    return days;
  },

  async exportUserSessions(userId: string | unknown): Promise<SessionDetail[]> {
    const uid = String(userId);
    if (isMongoReady()) {
      const docs = (await ChatSession.find({ userId: uid, isDeleted: false })
        .sort({ lastMessageAt: -1 })
        .lean()) as unknown as ChatSessionRecord[];
      return docs.map(serializeSessionDetail).filter((s): s is SessionDetail => s !== null);
    }
    return [...inMemorySessions.values()]
      .filter((s) => s.userId === uid && !s.isDeleted)
      .map(serializeSessionDetail)
      .filter((s): s is SessionDetail => s !== null);
  },

  async deleteAllUserSessions(userId: string | unknown): Promise<boolean> {
    const uid = String(userId);
    await purgeUserCheckpoints(uid, null);
    for (const [key, session] of inMemorySessions.entries()) {
      if (session.userId === uid) {
        await shortTermMemory.clearSession(uid, session.threadId);
        inMemorySessions.delete(key);
      }
    }
    if (isMongoReady()) {
      await ChatSession.deleteMany({ userId: uid });
    }
    return true;
  },
};
