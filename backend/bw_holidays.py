from datetime import datetime, timedelta


def _easter(year: int) -> datetime:
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    ll = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * ll) // 451
    month = (h + ll - 7 * m + 114) // 31
    day = ((h + ll - 7 * m + 114) % 31) + 1
    return datetime(year, month, day)


def feiertage_bw(year: int):
    e = _easter(year)
    s = lambda dt: dt.strftime("%Y-%m-%d")
    return [
        ("Neujahr", s(datetime(year, 1, 1))),
        ("Heilige Drei Könige", s(datetime(year, 1, 6))),
        ("Karfreitag", s(e - timedelta(days=2))),
        ("Ostermontag", s(e + timedelta(days=1))),
        ("Tag der Arbeit", s(datetime(year, 5, 1))),
        ("Christi Himmelfahrt", s(e + timedelta(days=39))),
        ("Pfingstmontag", s(e + timedelta(days=50))),
        ("Fronleichnam", s(e + timedelta(days=60))),
        ("Tag der Deutschen Einheit", s(datetime(year, 10, 3))),
        ("Allerheiligen", s(datetime(year, 11, 1))),
        ("1. Weihnachtstag", s(datetime(year, 12, 25))),
        ("2. Weihnachtstag", s(datetime(year, 12, 26))),
    ]


FERIEN_BW = [
    ("Sommerferien", "2026-07-30", "2026-09-12"),
    ("Herbstferien", "2026-10-26", "2026-10-31"),
    ("Weihnachtsferien", "2026-12-23", "2027-01-09"),
    ("Osterferien", "2027-03-30", "2027-04-03"),
    ("Pfingstferien", "2027-05-18", "2027-05-29"),
    ("Sommerferien", "2027-07-29", "2027-09-11"),
    ("Herbstferien", "2027-11-02", "2027-11-06"),
    ("Weihnachtsferien", "2027-12-23", "2028-01-08"),
]
