import { type $Fetch, createFetch, type FetchOptions } from "ofetch";
import { z } from "zod";

import { logger } from "./logger";

const requestErrorBodySchema = z.object({
  traceId: z.string().nullish(),
  code: z.string().nullish(),
  message: z.string().nullish(),
  error: z.string().nullish(),
  detail: z.unknown().nullish(),
});

export const requestErrorSchema = z.object({
  traceId: z.string().optional(),
  message: z.string().optional(),
  detail: z.unknown().nullish(),
  type: z.number(),
});

export class ResponseError extends Error {
  constructor(public error: z.infer<typeof requestErrorSchema>) {
    super(error.message ?? `Request failed with status ${error.type}`);
    this.name = "ResponseError";
  }
}

export class ResultDecodeError extends Error {
  constructor(public error: z.ZodError) {
    super(error.message);
    this.name = "ResultDecodeError";
  }
}

export class FatalRequestError extends Error {
  constructor(public error: Error) {
    super(error.message);
    this.name = "FatalRequestError";
  }
}

export const rofetch = createFetch({
  defaults: {
    retryStatusCodes: [400, 408, 409, 425, 429, 502, 503, 504],
    retry: 0,
    retryDelay: 300,
  },
}).create({
  async onResponseError({ request, response, options }) {
    if (!response.ok) {
      const decoded = requestErrorBodySchema.safeParse(response._data);
      if (!decoded.success) {
        throw new ResponseError({
          traceId: undefined,
          message: `Request failed with status ${response.status}`,
          detail: response._data,
          type: response.status,
        });
      }
      throw new ResponseError({
        traceId: decoded.data.traceId ?? undefined,
        message:
          decoded.data.message ??
          decoded.data.error ??
          decoded.data.code ??
          `Request failed with status ${response.status}`,
        detail: decoded.data.detail,
        type: response.status,
      });
    }

    if (options.retry) {
      logger.warn(
        `external request ${String(request)} with error ${response.status} remaining retry attempts: ${options.retry}`
      );
    }
  },
  onRequestError({ request, error }) {
    if (error.name === "AbortError") return;
    logger.error(`external request ${String(request)} fail: ${String(error)}`);
  },
});

export type AllowedFetchOptions = Pick<
  FetchOptions & RequestInit,
  | "body"
  | "query"
  | "headers"
  | "method"
  | "signal"
  | "timeout"
  | "retry"
  | "retryDelay"
  | "retryStatusCodes"
  | "credentials"
  | "keepalive"
>;

type FormUrlEncoded = Record<string, string>;
type Form = Record<string, unknown> | FormData;

type BodyOptions =
  | {
      json?: Record<string, unknown>;
      form?: never;
      formData?: never;
      body?: never;
    }
  | { json?: never; form?: FormUrlEncoded; formData?: never; body?: never }
  | { json?: never; form?: never; formData?: Form; body?: never }
  | { json?: never; form?: never; formData?: never; body?: BodyInit | null };

export type ExtendFetchOptions<TSchema extends z.ZodType | undefined = z.ZodType | undefined> =
  AllowedFetchOptions & {
    native?: boolean;
    schema?: TSchema;
  } & BodyOptions;

type InferResponse<T extends ExtendFetchOptions> = T["schema"] extends z.ZodType
  ? z.output<NonNullable<T["schema"]>>
  : unknown;

export type APIOptions = Omit<
  AllowedFetchOptions,
  "body" | "query" | "schema" | "headers" | "method"
>;

export class Fetch {
  constructor(
    private readonly fetchInstance: $Fetch = rofetch,
    private readonly options?: FetchOptions
  ) {}

  private async request<T extends ExtendFetchOptions>(
    request: string,
    options?: T
  ): Promise<InferResponse<T>> {
    const nextOptions = { ...(options ?? {}) };
    let body: FetchOptions["body"] = nextOptions.body;

    if ("body" in nextOptions) delete nextOptions.body;
    if ("json" in nextOptions && nextOptions.json !== undefined) {
      body = nextOptions.json;
      delete nextOptions.json;
    }
    if ("form" in nextOptions && nextOptions.form) {
      body = new URLSearchParams(nextOptions.form).toString();
      nextOptions.headers = {
        ...(nextOptions.headers ?? {}),
        "content-type": "application/x-www-form-urlencoded",
      };
      delete nextOptions.form;
    }
    if ("formData" in nextOptions && nextOptions.formData) {
      body = nextOptions.formData as FormData | BodyInit;
      delete nextOptions.formData;
    }

    try {
      if (nextOptions.native) {
        const response = await this.fetchInstance.native(request, {
          ...this.options,
          ...nextOptions,
          body: body as any,
        });
        return response as InferResponse<T>;
      }

      const response = await this.fetchInstance(request, {
        ...this.options,
        ...nextOptions,
        body,
      });

      if (nextOptions.schema) {
        const decoded = nextOptions.schema.safeParse(response);
        if (!decoded.success) {
          throw new ResultDecodeError(decoded.error);
        }
        return decoded.data as InferResponse<T>;
      }

      return response as InferResponse<T>;
    } catch (error) {
      if (
        error instanceof ResponseError ||
        error instanceof ResultDecodeError ||
        error instanceof FatalRequestError
      ) {
        throw error;
      }
      throw new FatalRequestError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  get<T extends Omit<ExtendFetchOptions, "form" | "json" | "formData">>(
    request: string,
    options?: T
  ): Promise<InferResponse<T>> {
    return this.request(request, { ...options, method: "GET" } as T);
  }

  post<T extends ExtendFetchOptions = ExtendFetchOptions>(
    request: string,
    options?: T
  ): Promise<InferResponse<T>> {
    return this.request(request, { ...options, method: "POST" } as T);
  }

  put<T extends ExtendFetchOptions = ExtendFetchOptions>(
    request: string,
    options?: T
  ): Promise<InferResponse<T>> {
    return this.request(request, { ...options, method: "PUT" } as T);
  }

  patch<T extends ExtendFetchOptions = ExtendFetchOptions>(
    request: string,
    options?: T
  ): Promise<InferResponse<T>> {
    return this.request(request, { ...options, method: "PATCH" } as T);
  }

  delete<T extends ExtendFetchOptions = ExtendFetchOptions>(
    request: string,
    options?: T
  ): Promise<InferResponse<T>> {
    return this.request(request, { ...options, method: "DELETE" } as T);
  }

  head<T extends ExtendFetchOptions = ExtendFetchOptions>(
    request: string,
    options?: T
  ): Promise<InferResponse<T>> {
    return this.request(request, { ...options, method: "HEAD" } as T);
  }

  extend(options: FetchOptions) {
    return new Fetch(this.fetchInstance, { ...this.options, ...options });
  }
}

export const f = new Fetch();
export { createFetch };
