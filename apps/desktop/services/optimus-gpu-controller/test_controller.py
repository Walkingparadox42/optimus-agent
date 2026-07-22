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
        for mode in ("image", "llm"):
            with self.subTest(mode=mode):
                self.assertEqual(controller.detect_mode(self.states(mode)), mode)

    def test_multiple_active_services_are_never_reported_as_ready(self):
        self.assertEqual(controller.detect_mode(self.states("image", "llm")), "mixed")


class ContractTests(unittest.TestCase):
    def test_public_modes_are_explicit(self):
        self.assertEqual(controller.MODES, ("image", "llm", "idle"))

    def test_every_workload_has_a_distinct_service(self):
        units = {(value["ct"], value["unit"]) for value in controller.SERVICES.values()}
        self.assertEqual(len(units), 2)

    def test_removed_voicebox_is_not_a_managed_service(self):
        self.assertNotIn("voice", controller.SERVICES)
        self.assertNotIn("voice", controller.MODES)
        self.assertFalse(any("voicebox" in str(value).lower() for value in controller.DEFAULT_CONFIG.values()))


if __name__ == "__main__":
    unittest.main()
