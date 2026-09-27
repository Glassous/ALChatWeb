from __future__ import annotations

from contextlib import asynccontextmanager
import asyncio

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .ai import AIService
from .config import settings
from .conversations import Conversations, TemporaryConversations
from .storage import ModelConfig, Storage, User
from .streams import StreamManager


class State:
    def __init__(self):
        self.cfg = settings()
        self.db = Storage(self.cfg)
        self.ai = AIService(self.cfg)
        self.conversations = Conversations(self.db)
        self.temp = TemporaryConversations(self.db)
        self.streams = StreamManager()

    def connect(self):
        self.db.connect()
        with self.db.session() as s:
            for c in s.query(ModelConfig).all():
                self.ai.configure(c.mode, c.api_key, c.base_url, c.model)
            if not s.query(User).filter(User.role == "admin").first():
                first = s.query(User).order_by(User.created_at).first()
                if first:
                    first.role = "admin"

    def expire_memberships(self):
        from .core import credits_for, now
        with self.db.session() as s:
            settings = self.db.mongo["system_settings"].find_one({})
            for user in s.query(User).filter(User.member_type != "free", User.member_expiry < now()).all():
                user.member_type = "free"
                user.member_expiry = None
                user.credits = credits_for("free", settings)
                user.last_credit_reset_at = now()


async def _expiry_loop(instance: State):
    while True:
        await asyncio.sleep(3600)
        await asyncio.to_thread(instance.expire_memberships)


state: State | None = None


def current() -> State:
    global state
    if state is None:
        state = State()
    return state


@asynccontextmanager
async def lifespan(app: FastAPI):
    instance = current()
    instance.connect()
    expiry = asyncio.create_task(_expiry_loop(instance))
    try:
        yield
    finally:
        expiry.cancel()
        instance.db.close()


app = FastAPI(lifespan=lifespan, redirect_slashes=False, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in settings().ALLOW_ORIGINS.split(",")],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Origin", "Content-Type", "Accept", "Authorization"],
    expose_headers=["Content-Length", "X-New-Token"],
)


@app.middleware("http")
async def renew_token(request: Request, call_next):
    response = await call_next(request)
    if new_token := getattr(request.state, "new_token", None):
        response.headers["X-New-Token"] = new_token
    return response


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    return JSONResponse(exc.detail if isinstance(exc.detail, dict) else {"error": str(exc.detail)}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    return JSONResponse({"error": "Invalid request"}, status_code=400)


@app.get("/health")
def health():
    s = current()
    statuses = {"mongodb": "ok", "redis": "ok"}
    try:
        s.db.mongo_client.admin.command("ping")
    except Exception:
        statuses["mongodb"] = "error"
    try:
        s.db.redis.ping()
    except Exception:
        statuses["redis"] = "error"
    return {"status": "ok" if all(v == "ok" for v in statuses.values()) else "partial_outage", **statuses, "version": "1.0.0", "gin_mode": s.cfg.GIN_MODE}


from .routes import auth_routes, conversation_routes, chat_routes, aling_routes, misc_routes, admin_routes

for router in (auth_routes.router, conversation_routes.router, chat_routes.router, aling_routes.router, misc_routes.router, admin_routes.router):
    app.include_router(router)
