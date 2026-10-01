"""Idempotent import from legacy MongoDB collections into existing MySQL tables.

Run with `python -m app.migrate` while the API is stopped. Existing MySQL rows
always win, so rerunning the command does not overwrite live data.
For an existing installation missing Agent storage, use `--agent-only` to add
only the billing table and MongoDB indexes without importing legacy accounts.
"""
from __future__ import annotations

import argparse

from bson import ObjectId

from .config import settings
from .storage import AgentUsage, Announcement, Feedback, ModelConfig, Storage, User


def migrate_agents(db: Storage) -> None:
    """Add only Agent storage; no legacy import or changes to existing accounts."""
    AgentUsage.__table__.create(db.engine, checkfirst=True)
    from .agents import agent_indexes
    agent_indexes(db)


def _text(value):
    return str(value) if isinstance(value, ObjectId) else value


def migrate(agent_only: bool = False) -> dict[str, int]:
    db = Storage(settings())
    try:
        db.connect()
        if agent_only:
            migrate_agents(db)
            return {"agent_schema": 1}
        # Schema creation and legacy import remain an operator-run operation.
        from .storage import Base
        Base.metadata.create_all(db.engine)
        migrate_agents(db)
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
        return counts
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agent-only", action="store_true", help="Only add Agent billing table and MongoDB indexes; skip legacy data import")
    print(migrate(agent_only=parser.parse_args().agent_only))
