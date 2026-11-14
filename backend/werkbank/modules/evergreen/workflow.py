"""Der Ablauf eines Evergreen-Vorgangs, gelesen aus workflow.yaml."""

from functools import lru_cache
from pathlib import Path

from werkbank.core.workflow import WorkflowDefinition, load_workflow

WORKFLOW_FILE = Path(__file__).with_name("workflow.yaml")


@lru_cache
def evergreen_workflow() -> WorkflowDefinition:
    return load_workflow(WORKFLOW_FILE)
