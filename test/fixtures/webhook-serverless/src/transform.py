def run(input):
    orders = input.get("orders") or []
    cur = input["trmnl"]["plugin_settings"]["custom_fields_values"]["currency"]
    total = sum(o.get("amount", 0) for o in orders)
    return {"summary": {"count": len(orders), "total": f"{cur} {total:.2f}", "latest": orders[-1]["name"] if orders else None}, "orders": orders}
