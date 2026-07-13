# pylint: disable=C0111,R0903
"""Chronomaxi statusline module for bumblebee-status."""

import subprocess

import core.module
import core.widget


class Module(core.module.Module):
    def __init__(self, config, theme):
        super().__init__(config, theme, core.widget.Widget(self.output))
        self._text = "chronomaxi"
        self._command = self.parameter("command", "~/.local/bin/chronomaxi-status")

    def output(self, widget):
        return self._text

    def update(self):
        try:
            completed = subprocess.run(
                self._command,
                shell=True,
                check=False,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=10,
            )
        except Exception:
            self._text = "chronomaxi unavailable"
            return
        text = completed.stdout.strip()
        self._text = text if text else "chronomaxi unavailable"
