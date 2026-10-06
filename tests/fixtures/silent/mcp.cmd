@rem The Windows form of this fixture: say one line, then hold stdin open and
@rem answer nothing until the Host closes it.
@echo silent: the Plugin Server is up and will say no more>&2
@findstr "^" > nul
