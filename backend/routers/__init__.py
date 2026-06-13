"""Cravitoo backend routers.

Routers are split out of the monolithic server.py and injected with shared
dependencies (db, helpers, get_current_user) via make_router(...) factories.
"""
