"""Tests for structural plan validation."""

from __future__ import annotations

from hangar.range_safety.validators.structural import validate_structural


def test_valid_aerostruct_plan_passes(valid_aerostruct_plan, catalog_dir):
    """A well-formed aerostruct plan produces no errors."""
    findings = validate_structural(valid_aerostruct_plan, catalog_dir=catalog_dir)
    errors = [f for f in findings if f["severity"] == "error"]
    assert errors == [], f"Unexpected errors: {errors}"


def test_valid_aero_plan_passes(valid_aero_plan, catalog_dir):
    """A well-formed aero-only plan produces no errors."""
    findings = validate_structural(valid_aero_plan, catalog_dir=catalog_dir)
    errors = [f for f in findings if f["severity"] == "error"]
    assert errors == [], f"Unexpected errors: {errors}"


def test_bad_component_type(valid_aero_plan, catalog_dir):
    """Unknown component type is caught."""
    valid_aero_plan["components"][0]["type"] = "oas/NonexistentType"
    findings = validate_structural(valid_aero_plan, catalog_dir=catalog_dir)
    errors = [f for f in findings if f["severity"] == "error"]
    assert any(f["check"] == "component_type_exists" for f in errors)


def test_even_num_y(valid_aero_plan, catalog_dir):
    """Even num_y is caught."""
    valid_aero_plan["components"][0]["config"]["surfaces"][0]["num_y"] = 6
    findings = validate_structural(valid_aero_plan, catalog_dir=catalog_dir)
    errors = [f for f in findings if f["severity"] == "error"]
    assert any(f["check"] == "num_y_odd" for f in errors)


def test_duplicate_component_ids(catalog_dir):
    """Duplicate component IDs are caught."""
    plan = {
        "metadata": {"id": "test", "name": "Test", "version": 1},
        "components": [
            {"id": "wing", "type": "oas/AeroPoint", "config": {"surfaces": [{"name": "w", "num_y": 7}]}},
            {"id": "wing", "type": "oas/AeroPoint", "config": {"surfaces": [{"name": "w2", "num_y": 5}]}},
        ],
    }
    findings = validate_structural(plan, catalog_dir=catalog_dir)
    errors = [f for f in findings if f["severity"] == "error"]
    assert any(f["check"] == "duplicate_component_id" for f in errors)


def test_aerostruct_missing_fem_model(catalog_dir):
    """AerostructPoint without fem_model_type is caught."""
    plan = {
        "metadata": {"id": "test", "name": "Test", "version": 1},
        "components": [
            {
                "id": "wing",
                "type": "oas/AerostructPoint",
                "config": {
                    "surfaces": [
                        {"name": "wing", "num_y": 7, "span": 10.0}
                    ]
                },
            }
        ],
    }
    findings = validate_structural(plan, catalog_dir=catalog_dir)
    errors = [f for f in findings if f["severity"] == "error"]
    assert any(f["check"] == "fem_model_required" for f in errors)


def test_fem_model_missing_material_props(catalog_dir):
    """fem_model_type without material properties is caught."""
    plan = {
        "metadata": {"id": "test", "name": "Test", "version": 1},
        "components": [
            {
                "id": "wing",
                "type": "oas/AerostructPoint",
                "config": {
                    "surfaces": [
                        {"name": "wing", "num_y": 7, "fem_model_type": "tube"}
                    ]
                },
            }
        ],
    }
    findings = validate_structural(plan, catalog_dir=catalog_dir)
    errors = [f for f in findings if f["severity"] == "error"]
    assert any(f["check"] == "material_properties" for f in errors)


def test_unknown_solver_type(valid_aero_plan, catalog_dir):
    """Unknown solver type is caught."""
    valid_aero_plan["solvers"] = {"nonlinear": {"type": "FakeSolver"}}
    findings = validate_structural(valid_aero_plan, catalog_dir=catalog_dir)
    errors = [f for f in findings if f["severity"] == "error"]
    assert any(f["check"] == "solver_type_valid" for f in errors)


def test_unknown_optimizer_type(valid_aerostruct_plan, catalog_dir):
    """Unknown optimizer type is caught."""
    valid_aerostruct_plan["optimizer"] = {"type": "FakeOptimizer"}
    findings = validate_structural(valid_aerostruct_plan, catalog_dir=catalog_dir)
    errors = [f for f in findings if f["severity"] == "error"]
    assert any(f["check"] == "optimizer_type_valid" for f in errors)


def test_empty_dv_name(valid_aerostruct_plan, catalog_dir):
    """Empty DV name is caught."""
    valid_aerostruct_plan["design_variables"] = [{"name": ""}]
    findings = validate_structural(valid_aerostruct_plan, catalog_dir=catalog_dir)
    errors = [f for f in findings if f["severity"] == "error"]
    assert any(f["check"] == "dv_name_nonempty" for f in errors)


def test_nl_solver_without_linear_warns(valid_aero_plan, catalog_dir):
    """Nonlinear solver without linear solver produces warning."""
    valid_aero_plan["solvers"] = {"nonlinear": {"type": "NewtonSolver"}}
    findings = validate_structural(valid_aero_plan, catalog_dir=catalog_dir)
    warnings = [f for f in findings if f["severity"] == "warning"]
    assert any(f["check"] == "linear_solver_specified" for f in warnings)


def test_env_var_overrides_catalog_walk(tmp_path, monkeypatch, catalog_dir):
    """HANGAR_CATALOG_DIR wins over the parent-directory walk (boundary
    doc contract; the walk cannot work from an installed wheel)."""
    from hangar.range_safety.validators.structural import _default_catalog_dir

    monkeypatch.setenv("HANGAR_CATALOG_DIR", str(tmp_path))
    assert _default_catalog_dir() == tmp_path

    monkeypatch.delenv("HANGAR_CATALOG_DIR")
    assert _default_catalog_dir() == catalog_dir


def test_env_var_catalog_is_loaded(tmp_path, monkeypatch, valid_aero_plan):
    """validate_structural with no catalog_dir reads the env-var catalog."""
    entry = tmp_path / "custom.yaml"
    entry.write_text("type: custom/OnlyType\n")
    monkeypatch.setenv("HANGAR_CATALOG_DIR", str(tmp_path))

    findings = validate_structural(valid_aero_plan)
    errors = [f for f in findings if f["severity"] == "error"]
    assert any(f["check"] == "component_type_exists" for f in errors)
