import { Request, Response } from "express";
import {
  longTermMemory,
  MEMORY_CONSENT_VERSION,
  hasMemoryConsent,
} from "../../../ai/memory/longTerm.js";
import {
  userRepository,
  UserRecord,
} from "../../../infrastructure/database/mongoose/repositories/MongooseUserRepository.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { successResponse, errorResponse } from "../../../shared/types/apiResponse.js";
import {
  updateMemorySchema,
  createMemorySchema,
  consentSchema,
} from "../../../shared/schemas/memorySchemas.js";

interface MemoryRecord {
  _id: { toString(): string };
  type: string;
  key: string;
  content: string;
  importance: number;
  confidence: number;
  source: string;
  createdAt: Date;
  [key: string]: unknown;
}

interface UserWithConsent extends UserRecord {
  memoryConsent?: {
    acceptedAt?: Date | null;
    version?: string | null;
  };
}

export const memoryController = {
  list: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userReq = req.user as UserWithConsent;
    const userId = userReq?._id
      ? userReq._id.toString()
      : (userReq as unknown as { id?: string })?.id || "";
    const user = ((await userRepository.findById(userId).catch(() => userReq)) ||
      userReq) as UserWithConsent;
    const memories = (await longTermMemory.listUserMemories(userId)) as MemoryRecord[];

    res.status(200).json(
      successResponse({
        memories: memories.map((m) => ({
          id: m._id.toString(),
          type: m.type,
          key: m.key,
          content: m.content,
          importance: m.importance,
          confidence: m.confidence,
          source: m.source,
          createdAt: m.createdAt,
        })),
        memoryPaused: Boolean((user || userReq)?.memoryPaused),
        consent: {
          accepted: hasMemoryConsent(user || userReq),
          version: MEMORY_CONSENT_VERSION,
          acceptedAt: (user || userReq)?.memoryConsent?.acceptedAt || null,
        },
      }),
    );
  }),

  getConsent: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userReq = req.user as UserWithConsent;
    const userId = userReq?._id
      ? userReq._id.toString()
      : (userReq as unknown as { id?: string })?.id || "";
    const user = ((await userRepository.findById(userId).catch(() => userReq)) ||
      userReq) as UserWithConsent;
    res.status(200).json(
      successResponse({
        accepted: hasMemoryConsent(user || userReq),
        version: MEMORY_CONSENT_VERSION,
        acceptedAt: (user || userReq)?.memoryConsent?.acceptedAt || null,
        memoryPaused: Boolean((user || userReq)?.memoryPaused),
      }),
    );
  }),

  updateConsent: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const parsed = consentSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json(
          errorResponse(
            "VALIDATION_ERROR",
            `Invalid memory consent payload. Version must be ${MEMORY_CONSENT_VERSION}.`,
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }
    const userReq = req.user as UserWithConsent;
    const userId = userReq?._id
      ? userReq._id.toString()
      : (userReq as unknown as { id?: string })?.id || "";
    if (parsed.data.accepted) {
      const acceptedAt = new Date();
      await userRepository.update(userId, {
        memoryConsent: { acceptedAt, version: MEMORY_CONSENT_VERSION },
      });
      res.status(200).json(
        successResponse({
          accepted: true,
          version: MEMORY_CONSENT_VERSION,
          acceptedAt,
        }),
      );
      return;
    }
    await userRepository.update(userId, {
      memoryConsent: { acceptedAt: null, version: null },
    });
    await longTermMemory.forgetAll(userId);
    res.status(200).json(
      successResponse({
        accepted: false,
        version: MEMORY_CONSENT_VERSION,
        acceptedAt: null,
      }),
    );
  }),

  create: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const parsed = createMemorySchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json(
          errorResponse(
            "VALIDATION_ERROR",
            parsed.error.issues[0]?.message || "Invalid memory payload",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }
    const userReq = req.user as UserWithConsent;
    const userId = userReq?._id
      ? userReq._id.toString()
      : (userReq as unknown as { id?: string })?.id || "";
    const user = (await userRepository.findById(userId).catch(() => userReq)) || userReq;
    const saved = (await (longTermMemory.writeMemory as (opts: unknown) => Promise<unknown>)({
      userId,
      user: user || userReq,
      userPlan: (user || userReq)?.plan,
      type: parsed.data.type,
      key: parsed.data.key,
      content: parsed.data.content,
      importance: parsed.data.importance,
      confidence: 1.0,
      source: "user_edit",
      requireConsent: true,
    })) as MemoryRecord | null;
    if (!saved) {
      res
        .status(409)
        .json(
          errorResponse(
            "MEMORY_PAUSED",
            "Memory capture is currently paused.",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }
    res.status(201).json(
      successResponse({
        memory: {
          id: saved._id.toString(),
          type: saved.type,
          key: saved.key,
          content: saved.content,
          importance: saved.importance,
          confidence: saved.confidence,
          source: saved.source,
          createdAt: saved.createdAt,
        },
      }),
    );
  }),

  update: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const parsed = updateMemorySchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json(
          errorResponse(
            "VALIDATION_ERROR",
            parsed.error.issues[0]?.message || "Invalid memory update payload",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }
    const userReq = req.user as UserWithConsent;
    const userId = userReq?._id
      ? userReq._id.toString()
      : (userReq as unknown as { id?: string })?.id || "";
    const { id } = req.params;
    const updated = (await longTermMemory.updateMemory(
      userId,
      id,
      parsed.data,
    )) as MemoryRecord | null;
    if (!updated) {
      res
        .status(404)
        .json(
          errorResponse(
            "MEMORY_NOT_FOUND",
            "Memory item not found",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }
    res.status(200).json(
      successResponse({
        memory: {
          id: updated._id.toString(),
          type: updated.type,
          key: updated.key,
          content: updated.content,
          importance: updated.importance,
          confidence: updated.confidence,
          source: updated.source,
          createdAt: updated.createdAt,
        },
      }),
    );
  }),

  delete: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userReq = req.user as UserWithConsent;
    const userId = userReq?._id
      ? userReq._id.toString()
      : (userReq as unknown as { id?: string })?.id || "";
    const { id } = req.params;

    await longTermMemory.deleteMemory(userId, id);
    res.status(200).json(successResponse({ message: "Memory removed successfully" }));
  }),

  forgetAll: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userReq = req.user as UserWithConsent;
    const userId = userReq?._id
      ? userReq._id.toString()
      : (userReq as unknown as { id?: string })?.id || "";

    await longTermMemory.forgetAll(userId);
    res.status(200).json(successResponse({ message: "All candidate memories purged" }));
  }),

  togglePause: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userReq = req.user as UserWithConsent;
    const userId = userReq?._id
      ? userReq._id.toString()
      : (userReq as unknown as { id?: string })?.id || "";
    const currentUser = ((await userRepository.findById(userId).catch(() => userReq)) ||
      userReq) as UserWithConsent;
    const updated = (await userRepository.update(userId, {
      memoryPaused: !(currentUser || userReq).memoryPaused,
    })) as UserWithConsent;

    res.status(200).json(
      successResponse({
        memoryPaused: updated?.memoryPaused,
        message: updated?.memoryPaused ? "Memory capture paused" : "Memory capture resumed",
      }),
    );
  }),
};
