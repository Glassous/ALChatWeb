"""Idempotent import from legacy MongoDB collections into existing MySQL tables.

Run with `python -m app.migrate` while the API is stopped. Existing MySQL rows
always win, so rerunning the command does not overwrite live data.
"""
from __future__ import annotations

from bson import ObjectId

from .config import settings
from .storage import Announcement, Feedback, ModelConfig, Storage, User


def _text(value):
    return str(value) if isinstance(value, ObjectId) else value


def migrate() -> dict[str, int]:
    db = Storage(settings())
    db.connect()
    # The legacy service created these tables on startup. Keep that setup in
    # the operator-run migration command, never in API startup.
    from .storage import Base
    Base.metadata.create_all(db.engine)
    counts: dict[str, int] = {}
    for collection, model in (("users", User), ("configs", ModelConfig), ("announcements", Announcement), ("feedbacks", Feedback)):
        inserted = 0
        with db.session() as session:
            for document in db.mongo[collection].find({}):
                key = document.get("mode") if model is ModelConfig else str(document.get("_id"))
                if not key or session.get(model, key):
                    continue
                columns = {col.name for col in model.__table__.columns}
                values = {field: _text(value) for field, value in document.items() if field in columns}
                if model is not ModelConfig:
                    values["id"] = key
                if model is User and "include_datetime" in document:
                    values["include_date_time"] = document["include_datetime"]
                session.add(model(**values))
                inserted += 1
        counts[collection] = inserted
    db.close()
    return counts


if __name__ == "__main__":
    print(migrate())
