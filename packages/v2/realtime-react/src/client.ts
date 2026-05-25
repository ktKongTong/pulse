'use client'
import type { ClientPageMetadata } from "@ktfun/pulse-protocol";
import { nextConnection } from "./connection";
import { claimSession } from "./session";
import { RealtimeV2StateStore } from "./state";
import { CommonWsTransport } from "./transports/common";
import {
  PageWsTransport,
  type PageLeaveInput,
  type PageUpdateInput,
} from "./transports/page";
import { MediaWsTransport } from "./transports/media";
import type {
  ClientIdentity,
  PulseRealtimeV2Config,
} from "./types";

export class PulseRealtimeV2Client {
  private readonly store = new RealtimeV2StateStore();
  private readonly common: CommonWsTransport;
  private readonly pages: PageWsTransport;
  private readonly media: MediaWsTransport;
  private sessionPromise: Promise<ClientIdentity> | null = null;

  constructor(readonly config: PulseRealtimeV2Config) {
    this.common = new CommonWsTransport(config, this.store);
    this.pages = new PageWsTransport(config, this.store);
    this.media = new MediaWsTransport(config, this.store);
  }

  getSnapshot = () => {
    return this.store.getSnapshot();
  };

  subscribe = (listener: () => void) => {
    return this.store.subscribe(listener);
  };

  async ensureSession(): Promise<ClientIdentity> {
    const current = this.store.getSnapshot().identity;
    if (current) return current;
    if (this.sessionPromise) return this.sessionPromise;
    this.store.patch((draft) => {
      draft.common.connection = nextConnection("claiming_session");
    });

    this.sessionPromise = claimSession(this.config)
      .then((identity) => {
        this.store.patch((draft) => {
          draft.identity = identity;
        });
        return identity;
      })
      .finally(() => {
        this.sessionPromise = null;
      });

    return this.sessionPromise;
  }

  async connectCommon() {
    this.common.connect(await this.ensureSession());
  }

  async connectPage(canonicalUrl: string, page?: ClientPageMetadata) {
    this.pages.connect(canonicalUrl, await this.ensureSession(), page);
  }

  updatePage(canonicalUrl: string, frame: PageUpdateInput) {
    return this.pages.update(canonicalUrl, frame);
  }

  leavePage(canonicalUrl: string, frame: PageLeaveInput) {
    return this.pages.leave(canonicalUrl, frame);
  }

  closePage(canonicalUrl: string) {
    this.pages.close(canonicalUrl);
  }

  async connectMedia() {
    this.media.connect(await this.ensureSession());
  }

  requestStream() {
    if (this.store.getSnapshot().media.source.state !== "ready") return null;
    return this.media.requestStream();
  }

  stopStream() {
    return this.media.stopStream();
  }

  ackStream(streamId: string, generation: number, seq: number) {
    return this.media.ackStream(streamId, generation, seq);
  }

  dispose() {
    this.common.close();
    this.media.close();
    this.pages.closeAll();
    this.store.clearListeners();
  }
}
