package io.github.kt.pulsebar.ws.connection

import io.github.kt.pulsebar.logger.PulseLogCategory
import io.github.kt.pulsebar.logger.logger
import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.ClientWebSocketSession
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.client.request.header
import io.ktor.http.Url
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readReason
import io.ktor.websocket.readText
import io.ktor.websocket.send
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.channels.ClosedReceiveChannelException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.consumeAsFlow
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal data class WSConfig(
    val url: Url,
    val apiKey: String,
    val handShakeTimeout: Duration = 3.seconds,
)

internal class WSManager(internal val http: HttpClient, internal val scope: CoroutineScope) {
    internal lateinit var listenJob: Job
    internal lateinit var session: ClientWebSocketSession
    internal lateinit var incomingFlow: Flow<Frame>
    private val connectMutex = Mutex()
    private val _state = MutableStateFlow(WsConnectionState())
    internal val state: StateFlow<WsConnectionState> = _state.asStateFlow()

    private fun transition(event: WsConnectionEvent) {
        _state.update { it.reduce(event) }
    }
    internal suspend fun <T>connect(
        config: WSConfig,
        getHelloMsg: (session: ClientWebSocketSession) -> WSPayload,
        onHandshake: (suspend (payload: JsonObject) -> T),
    ):T = connectMutex.withLock {
        if(::listenJob.isInitialized) {
            listenJob.cancelAndJoin()
//            logger.info("cancel old connection")
        }

        logger(PulseLogCategory.StreamSession).d { "connecting" }
        transition(WsConnectionEvent.Connecting(config.url.toString()))

//        logger.info("Connecting to $deviceSessionId")
        val newSession = http.webSocketSession(urlString = config.url.toString()) {
            if (config.apiKey.isNotBlank()) {
                header("Authorization", "Bearer ${config.apiKey}")
            }
        }
        logger(PulseLogCategory.StreamSession).d { "connection opened" }
        session = newSession

        transition(WsConnectionEvent.Opened)
        try {
            transition(WsConnectionEvent.HelloSent)
            logger(PulseLogCategory.StreamSession).d { "handshake" }
            val r = handshake(getHelloMsg, onHandshake, config.handShakeTimeout)
            incomingFlow = newSession.incoming.consumeAsFlow()
                .onEach { transition(WsConnectionEvent.MessageReceived()) }
            transition(WsConnectionEvent.HelloAccepted)
            return@withLock r
        } catch (t: Throwable) {
            if (newSession.isActive) {
                newSession.close()
            }
            throw t
        }
        finally {

        }
    }

    internal suspend fun send(payload: WSPayload) {
        try {
            session.send(deviceV2Frame(payload))
            transition(WsConnectionEvent.MessageSent())
        } catch (t: Throwable) {
            transition(WsConnectionEvent.Failed(t.message ?: "unknown error"))
            throw t
        }
    }

    internal suspend fun send(bytes: ByteArray) {
        try {
            session.send(bytes)
            transition(WsConnectionEvent.MessageSent(binary = true))
        } catch (t: Throwable) {
            transition(WsConnectionEvent.Failed(t.message ?: "unknown error"))
            throw t
        }
    }

    internal suspend fun connect(
        config: WSConfig,
        getHelloMsg: (session: ClientWebSocketSession) -> WSPayload,) = connect(config, getHelloMsg) {}
    private suspend fun <T>handshake(
        getHelloMsg: (session: ClientWebSocketSession) -> WSPayload,
        onHandshake: suspend (payload: JsonObject) -> T,timeout: Duration = 10.seconds
    ): T {

        val payload: JsonObject = withTimeoutOrNull(timeout) {
            logger(PulseLogCategory.StreamSession).d { "sending handshake frame" }
            send(getHelloMsg(session))
            while (true) {
                logger(PulseLogCategory.StreamSession).d { "frame received" }
                when (val frame = session.incoming.receive()) {
                    is Frame.Text -> {
                        val ack = frame.readText().toHelloAckPayloadOrNull()
                        if (ack != null) return@withTimeoutOrNull ack
                    }

                    is Frame.Close -> {
                        val reason = frame.readReason()
                        logger(PulseLogCategory.StreamSession).e {
                            "device common closed before hello_ack: " +
                                    "code=${reason?.code} message=${reason?.message}"
                        }
                        error(
                            "device common closed before hello_ack: " +
                                "code=${reason?.code} message=${reason?.message}"
                        )
                    }

                    else -> Unit
                }
            }
            error("unreachable")
        } ?: error("device hello_ack timeout after $timeout")
        val accepted = payload["accepted"]
            ?.jsonPrimitive
            ?.booleanOrNull
            ?: false
        if (!accepted) {
            error("device common hello rejected")
        }
        return onHandshake(payload)

    }

    internal suspend fun listen(listener: suspend (session: ClientWebSocketSession) -> Unit) = connectMutex.withLock {
        if (::listenJob.isInitialized) {
            listenJob.cancelAndJoin()
        }
        val currentSession = session
        listenJob = scope.launch {
            try {
                listener(currentSession)
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                if (error is ClosedReceiveChannelException) {
                    transition(WsConnectionEvent.Closed(error.message))
                    logger(PulseLogCategory.StreamSession).d { "ws.listen.closed url=${currentSession.call.request.url}" }
                } else {
                    transition(WsConnectionEvent.Failed(error.message ?: "unknown error"))
                    logger(PulseLogCategory.StreamSession).w(error) { "ws.listen.failed url=${currentSession.call.request.url}" }
                }
            } finally {
                if (currentSession.isActive) {
                    currentSession.close()
                }
            }
        }
    }


}



internal fun String.toHelloAckPayloadOrNull(): JsonObject? {
    val obj = runCatching {
        logger(PulseLogCategory.StreamSession).d { "parsing $this" }
        deviceV2Json.parseToJsonElement(this).jsonObject
    }.getOrNull() ?: return null
    if (obj["type"]?.jsonPrimitive?.contentOrNull != "hello_ack") {
        return null
    }
    return obj["payload"]?.jsonObject
}
