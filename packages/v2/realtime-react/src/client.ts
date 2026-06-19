'use client'
import type { ClientPageMetadata } from "@ktfun/pulse-protocol";
import { nextConnection } from "./connection";
import { claimSession } from "./session";
import { RealtimeV2StateStore } from "./state";
import { ClientWsTransport } from "./transports/client-ws";
import {
  PageWsTransport,
  type PageLeaveInput,
  type PageUpdateInput,
} from "./transports/page";
import { RetryBudget } from "./reconnect";
import type {
  ClientIdentity,
  PulseRealtimeV2Config,
} from "./types";

export class PulseRealtimeV2Client {
  private readonly store = new RealtimeV2StateStore();
  private readonly clientWs: ClientWsTransport;
  private readonly pages: PageWsTransport;
  private sessionPromise: Promise<ClientIdentity> | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly clientRetry: RetryBudget;
  private disposed = false;

  constructor(readonly config: PulseRealtimeV2Config) {
    this.clientWs = new ClientWsTransport(config, this.store);
    this.pages = new PageWsTransport(config, this.store);
    this.clientRetry = new RetryBudget(
      this.store,
      ["common", "media"],
      "client_ws_reconnect_exhausted",
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
      draft.media.connection = nextConnection("claiming_session");
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
    this.clientRetry.reset();
    this.connectPromise = this.connectOnce().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  async connectPage(canonicalUrl: string, page?: ClientPageMetadata) {
    const identity = await this.connectClientStage();
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
    return this.clientWs.requestStream();
  }

  stopStream() {
    return this.clientWs.stopStream();
  }

  ackStream(streamId: string, generation: number, seq: number) {
    return this.clientWs.ackStream(streamId, generation, seq);
  }

  dispose() {
    this.disposed = true;
    this.connectPromise = null;
    this.clientRetry.dispose();
    this.clientWs.close();
    this.pages.closeAll();
    this.store.clearListeners();
  }

  private async connectOnce() {
    await this.connectClientStage();
  }

  private async connectClientStage() {
    const identity = await this.ensureSession();
    return this.clientWs.connect(identity, {
      onUnexpectedClose: () => this.handleClientClosed(),
    }).then((acceptedIdentity) => {
      this.clientRetry.reset();
      return acceptedIdentity;
    });
  }

  private handleClientClosed() {
    if (this.disposed) return;
    this.clientRetry.schedule(() => {
      void this.connectClientStage()
        .catch(() => this.handleClientClosed());
    });
  }
}
