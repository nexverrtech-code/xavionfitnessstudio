"""Application errors with human-readable messages.

Raw exceptions never reach the client: every error response has the shape
``{"error": {"code": "...", "message": "...", "fields": {...}}}``.
"""

from __future__ import annotations


class AppError(Exception):
    status = 400
    code = "BAD_REQUEST"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status: int | None = None,
        fields: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        if status:
            self.status = status
        self.fields = fields or None

    def to_dict(self) -> dict:
        body: dict = {"code": self.code, "message": self.message}
        if self.fields:
            body["fields"] = self.fields
        return {"error": body}


class BadRequest(AppError):
    status = 400
    code = "BAD_REQUEST"


class Unauthorized(AppError):
    status = 401
    code = "UNAUTHORIZED"


class Forbidden(AppError):
    status = 403
    code = "FORBIDDEN"


class NotFound(AppError):
    status = 404
    code = "NOT_FOUND"


class Conflict(AppError):
    status = 409
    code = "CONFLICT"


class ValidationFailed(AppError):
    status = 422
    code = "VALIDATION_FAILED"


class TooManyRequests(AppError):
    status = 429
    code = "TOO_MANY_REQUESTS"


class ServiceUnavailable(AppError):
    status = 503
    code = "SERVICE_UNAVAILABLE"
