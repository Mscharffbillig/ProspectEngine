from datetime import UTC, datetime, timedelta

from worker.queue import is_claimable, next_state_after_failure, retry_delay_seconds

NOW = datetime(2026, 7, 17, 12, 0, tzinfo=UTC)


class TestIsClaimable:
    def test_pending_and_due(self):
        assert is_claimable("pending", NOW - timedelta(minutes=1), None, now=NOW)

    def test_pending_but_scheduled_in_future(self):
        assert not is_claimable("pending", NOW + timedelta(minutes=5), None, now=NOW)

    def test_running_with_live_lock_not_claimable(self):
        assert not is_claimable(
            "running", NOW - timedelta(hours=1), NOW + timedelta(minutes=5), now=NOW
        )

    def test_running_with_expired_lock_claimable(self):
        assert is_claimable(
            "running", NOW - timedelta(hours=1), NOW - timedelta(minutes=1), now=NOW
        )

    def test_done_failed_cancelled_never_claimable(self):
        for status in ("done", "failed", "cancelled"):
            assert not is_claimable(status, NOW - timedelta(hours=1), None, now=NOW)


class TestFailureTransitions:
    def test_retries_until_max_attempts(self):
        assert next_state_after_failure(attempts=1, max_attempts=3) == "pending"
        assert next_state_after_failure(attempts=2, max_attempts=3) == "pending"

    def test_failed_at_max_attempts(self):
        assert next_state_after_failure(attempts=3, max_attempts=3) == "failed"
        assert next_state_after_failure(attempts=4, max_attempts=3) == "failed"

    def test_backoff_grows(self):
        assert retry_delay_seconds(1) == 30
        assert retry_delay_seconds(2) == 60
        assert retry_delay_seconds(3) == 120
