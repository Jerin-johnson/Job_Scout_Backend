import { ProfileEntity, IRoleHistoryItem, IPreferences } from "../../../../domain/entities/Profile.js";

export class ProfileMapper {
  static toEntity(doc: unknown): ProfileEntity | null {
    if (!doc || typeof doc !== "object") return null;
    const raw = doc as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id : raw._id ? String(raw._id) : "";
    const userId = raw.userId ? String(raw.userId) : "";

    const rawSkills = Array.isArray(raw.skills) ? raw.skills : [];
    const skills: string[] = rawSkills
      .map((s) => {
        if (typeof s === "string") return s;
        if (s && typeof s === "object" && "name" in s) {
          return String((s as Record<string, unknown>).name);
        }
        return "";
      })
      .filter(Boolean);

    const rawRoles = Array.isArray(raw.roles) ? raw.roles : [];
    const roles: IRoleHistoryItem[] = rawRoles.map((item) => {
      const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return {
        title: typeof r.title === "string" ? r.title : "",
        company: typeof r.company === "string" ? r.company : "",
        startDate: typeof r.startDate === "string" ? r.startDate : "",
        endDate: typeof r.endDate === "string" ? r.endDate : "",
        current: Boolean(r.isCurrent || r.current),
        description: typeof r.description === "string" ? r.description : "",
        skills: Array.isArray(r.skills) ? (r.skills as string[]) : [],
      };
    });

    const preferences: IPreferences =
      raw.preferences && typeof raw.preferences === "object"
        ? (raw.preferences as IPreferences)
        : {};

    const rawMatchTokens = Array.isArray(raw.matchTokens) ? raw.matchTokens : [];
    const matchTokens: string[] = rawMatchTokens.map(String);

    const rawMatchCountryCodes = Array.isArray(raw.matchCountryCodes) ? raw.matchCountryCodes : [];
    const matchCountryCodes: string[] = rawMatchCountryCodes.map(String);

    return {
      id,
      userId,
      skills,
      roles,
      preferences,
      careerProfile:
        raw.careerProfile && typeof raw.careerProfile === "object"
          ? (raw.careerProfile as Record<string, unknown>)
          : undefined,
      matchTokens,
      matchCountryCodes,
      version: typeof raw.version === "number" ? raw.version : 1,
      createdAt: raw.createdAt instanceof Date ? raw.createdAt : new Date(String(raw.createdAt || Date.now())),
      updatedAt: raw.updatedAt instanceof Date ? raw.updatedAt : new Date(String(raw.updatedAt || Date.now())),
    };
  }

  static toPersistence(entity: Partial<ProfileEntity>): Record<string, unknown> {
    const data: Record<string, unknown> = { ...entity };
    if (data.id) {
      data._id = data.id;
      delete data.id;
    }
    return data;
  }
}
