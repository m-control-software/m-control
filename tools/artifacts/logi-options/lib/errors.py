"""Error types. Every message must say what to do next (.claude/rules/errors.md)."""


class LogiError(Exception):
    """Expected, user-fixable failure (bad spec, app not found, agent would not stop)."""
    code = "LOGI_OPTIONS_FAILED"


class SpecError(LogiError):
    code = "SPEC_INVALID"


class CatalogError(LogiError):
    code = "CATALOG_CHANGED"


class StoreError(LogiError):
    code = "STORE_ERROR"


class VerifyError(LogiError):
    code = "VERIFY_FAILED"
