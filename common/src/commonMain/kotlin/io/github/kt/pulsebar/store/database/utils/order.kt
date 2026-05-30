package io.github.kt.pulsebar.store.database.utils


interface OrderableColumn {
    val col: String
}

enum class OrderType(val sql: String) {
    ASC("ASC"),
    DESC("DESC"),
}

data class Order<T : OrderableColumn>(
    val column: T,
    val type: OrderType,
) {
    fun toSql(): String {
        return "${column.col} ${type.sql}"
    }
}

data class OrderBy<T : OrderableColumn>(
    val orders: List<Order<T>>,
) {
    init {
        require(orders.isNotEmpty()) {
            "orders must not be empty"
        }
    }

    fun toSql(): String {
        return orders.joinToString(", ") { it.toSql() }
    }
}