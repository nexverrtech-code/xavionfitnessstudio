"""/api/reports — on-demand report data (JSON). The browser renders CSV / PDF; nothing is stored.

Staff get the basic reports; the expense report is admin-only.
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from core.errors import Forbidden
from services.context import Ctx
from services.report_service import KINDS, ReportService

from .contexts import staff_ctx
from .responses import raw_json

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/{kind}")
async def report(
    kind: str,
    from_: date | None = Query(None, alias="from"),
    to: date | None = None,
    ctx: Ctx = Depends(staff_ctx),
) -> Response:
    if kind == "expenses" and not ctx.user.is_admin:
        raise Forbidden("Only an admin can view the expense report.")
    if kind not in KINDS:
        raise Forbidden("Unknown report.")
    return raw_json(await ReportService(ctx).build(kind, from_, to))
