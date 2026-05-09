package io.github.kt.pulsebar.core.config

/**
 * Normalizes a list of endpoints to guarantee unique, non-blank ids, trims
 * free-form strings, and enforces `batchWindowSeconds >= 1`. Mirrors the
 * logic that used to live in `PulseBarPreferencesStore` so that writers of
 * the config store cannot produce malformed records.
 */
internal fun normalizeEndpoints(endpoints: List<EndpointProto>): List<EndpointProto> {
    if (endpoints.isEmpty()) return listOf(EndpointProto.default())
    val usedIds = mutableSetOf<String>()
    return endpoints.mapIndexed { index, endpoint ->
        val fallbackName = if (index == 0) EndpointProto.DEFAULT_NAME else "Endpoint ${index + 1}"
        val baseId = endpoint.id
            .trim()
            .ifBlank {
                endpoint.endpointUrl.trim().ifBlank { "endpoint-${index + 1}" }
            }
        var resolvedId = baseId
        var suffix = 2
        while (!usedIds.add(resolvedId)) {
            resolvedId = "$baseId-$suffix"
            suffix += 1
        }
        endpoint.copy(
            id = resolvedId,
            name = endpoint.name.trim().ifBlank { fallbackName },
            endpointUrl = endpoint.endpointUrl.trim(),
            workspaceId = endpoint.workspaceId.trim(),
            siteId = endpoint.siteId.trim(),
            batchWindowSeconds = endpoint.batchWindowSeconds.coerceAtLeast(1),
        )
    }
}

internal fun PulseBarConfigProto.normalized(): PulseBarConfigProto =
    copy(endpoints = normalizeEndpoints(endpoints))
