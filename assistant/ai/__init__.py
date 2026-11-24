"""Every AI the project uses, behind one configuration (`stages.json`) and one client."""

from . import config, servers
from .client import AIError, chat, chat_stream, models, ready, see, speak, text, transcribe
from .config import stage

__all__ = ["AIError", "chat", "chat_stream", "config", "models", "ready", "see", "servers", "speak", "stage", "text", "transcribe"]
