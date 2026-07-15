import unittest

import controller


class DetectModeTests(unittest.TestCase):
    def states(self, *active):
        return {
            name: {"active": name in active, "enabled": name in active}
            for name in controller.SERVICES
        }

    def test_idle_when_no_service_is_active(self):
        self.assertEqual(controller.detect_mode(self.states()), "idle")

    def test_single_active_service_is_the_mode(self):
        for mode in ("voice", "image", "llm"):
            with self.subTest(mode=mode):
                self.assertEqual(controller.detect_mode(self.states(mode)), mode)

    def test_multiple_active_services_are_never_reported_as_ready(self):
        self.assertEqual(controller.detect_mode(self.states("voice", "llm")), "mixed")


class ContractTests(unittest.TestCase):
    def test_public_modes_are_explicit(self):
        self.assertEqual(controller.MODES, ("voice", "image", "llm", "idle"))

    def test_every_workload_has_a_distinct_service(self):
        units = {(value["ct"], value["unit"]) for value in controller.SERVICES.values()}
        self.assertEqual(len(units), 3)


if __name__ == "__main__":
    unittest.main()
