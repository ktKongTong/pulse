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
import { RetryBudget } from "./reconnect";
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
  private connectPromise: Promise<void> | null = null;
  private readonly commonRetry: RetryBudget;
  private readonly mediaRetry: RetryBudget;
  private disposed = false;

  constructor(readonly config: PulseRealtimeV2Config) {
    this.common = new CommonWsTransport(config, this.store);
    this.pages = new PageWsTransport(config, this.store);
    this.media = new MediaWsTransport(config, this.store);
    this.commonRetry = new RetryBudget(
      this.store,
      "common",
      "common_ws_reconnect_exhausted",
    );
    this.mediaRetry = new RetryBudget(
      this.store,
      "media",
      "media_ws_reconnect_exhausted",
    );
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

  connect() {
    if (this.connectPromise) return this.connectPromise;
    this.disposed = false;
    this.commonRetry.reset();
    this.mediaRetry.reset();
    this.connectPromise = this.connectOnce().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  async connectPage(canonicalUrl: string, page?: ClientPageMetadata) {
    const identity = await this.connectCommonStage();
    this.pages.connect(canonicalUrl, identity, page);
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
    this.disposed = true;
    this.connectPromise = null;
    this.commonRetry.dispose();
    this.mediaRetry.dispose();
    this.common.close();
    this.media.close();
    this.pages.closeAll();
    this.store.clearListeners();
  }

  private async connectOnce() {
    const identity = await this.connectCommonStage();
    await this.connectMediaStage(identity);
  }

  private async connectCommonStage() {
    const identity = await this.ensureSession();
    return this.common.connect(identity, {
      onUnexpectedClose: () => this.handleCommonClosed(),
    }).then((acceptedIdentity) => {
      this.commonRetry.reset();
      return acceptedIdentity;
    });
  }

  private async connectMediaStage(identity: ClientIdentity) {
    return this.media.connect(identity, {
      onUnexpectedClose: () => this.handleMediaClosed(),
    }).then(() => {
      this.mediaRetry.reset();
    });
  }

  private handleCommonClosed() {
    if (this.disposed) return;
    this.media.close();
    this.commonRetry.schedule(() => {
      void this.connectCommonStage()
        .catch(() => this.handleCommonClosed());
    });
  }

  private handleMediaClosed() {
    if (this.disposed) return;
    this.mediaRetry.schedule(() => {
      void this.connectCommonStage()
        .then((identity) => {
          void this.connectMediaStage(identity).catch(() => undefined);
        })
        .catch(() => this.handleCommonClosed());
    });
  }
}
