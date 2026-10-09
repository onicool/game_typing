"""Select an already-installed Chromium browser; never download one."""
import os
import shutil
import sys
from pathlib import Path


def launch_chromium(playwright):
    executable = os.environ.get('CHROMIUM_EXECUTABLE')
    if executable and not Path(executable).is_file():
        raise FileNotFoundError(f'CHROMIUM_EXECUTABLE does not exist: {executable}')
    if not executable and sys.platform == 'darwin':
        chrome = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        if chrome.is_file():
            executable = str(chrome)
    if not executable:
        executable = shutil.which('chromium') or shutil.which('chromium-browser')
    options = {'headless': True}
    if executable:
        options['executable_path'] = executable
    # Existing Linux QA containers run as root; Mac retains normal sandboxing.
    if sys.platform.startswith('linux') and os.geteuid() == 0:
        options['args'] = ['--no-sandbox']
    return playwright.chromium.launch(**options)
