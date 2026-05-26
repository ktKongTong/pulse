package io.github.kt.pulsebar.export



private fun emptyInteractionState() =
    PulseBarInteractionState(
        pendingCount = 0,
        items = emptyList(),
        lastStatus = "disabled",
    )