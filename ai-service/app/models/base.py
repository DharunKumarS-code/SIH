"""Model interface. A real model implements `infer()` and is registered in
app.pipelines.registry so it transparently replaces the mock."""
from __future__ import annotations

from abc import ABC, abstractmethod


class InferenceModel(ABC):
    key: str
    name: str
    input_kind: str
    output_kind: str

    @abstractmethod
    def infer(self, payload: dict) -> dict:  # pragma: no cover - interface
        ...
