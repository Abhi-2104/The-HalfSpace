"""Production entry point: the API under /api and the built frontend (frontend/dist) at /, in one process.
The API keeps paths such as /matches and /fixtures, which the frontend's pages also use, so in production they must not
share a root: the browser asks /api/matches, and /matches is the page. Unknown page paths return index.html so the
frontend's router can handle them; unknown /api paths stay real 404s.

  uvicorn halfspace.server:root --host 127.0.0.1 --port 8742
Development keeps using halfspace.api:app on its own port (npm run dev points at it)."""
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from halfspace.api import app as api

DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


class SPAFiles(StaticFiles):
    """Static files, falling back to index.html for paths that are not files (client-side routes)."""

    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as e:
            if e.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


def build(dist: Path = DIST) -> FastAPI:
    root = FastAPI(docs_url=None, redoc_url=None, openapi_url=None,
                   lifespan=lambda _app: api.router.lifespan_context(api))  # a mounted app's own startup does not run otherwise
    root.mount("/api", api)
    if (dist / "index.html").exists():
        root.mount("/", SPAFiles(directory=dist, html=True), name="frontend")
    return root


root = build()
