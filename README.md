# obieg

**Marketplace z używaną odzieżą i obuwiem marek premium.** Kupujący dostają rzeczy ze zweryfikowanym stanem i płatnością chronioną do odbioru, a sprzedający wystawiają je w kilka minut i wysyłają przez Paczkomat InPost.

Start: **26 listopada 2026**, cała Polska.

---

## Funkcje

**Dla kupujących**
- Katalog z filtrami: dla kogo, kategoria, marka, rozmiar, stan i cena, plus sortowanie. Filtry zapisują się w adresie strony, więc wynik można wysłać linkiem.
- Strona produktu z galerią (przewijaną palcem na telefonie), opisem stanu według jednej skali i profilem sprzedawcy.
- Ulubione zapisane na koncie, dostępne na każdym urządzeniu.

**Dla sprzedających**
- Wystawianie jest darmowe. Obieg pobiera prowizję (domyślnie 10%) tylko od sprzedanych rzeczy. Stawkę zmienisz w jednym miejscu: `commission` w pliku `consts.js`.
- Wystawianie ogłoszeń z maksymalnie 10 zdjęciami, zmianą ich kolejności i edycją. Zdjęcia zmniejszają się automatycznie przed wysłaniem.
- Panel „Moje konto”: wszystkie ogłoszenia (aktywne, sprzedane, ukryte), statystyki oraz przyciski edycji, oznaczania jako sprzedane, ukrywania i usuwania.
- Portfel z saldem dostępnym i oczekującym, historią operacji i wypłatami na konto bankowe (z walidacją numeru IBAN).

**Konto i profil**
- Rejestracja z unikalną nazwą użytkownika sprawdzaną na bieżąco, logowanie i reset hasła przez e-mail.
- Publiczny profil pod adresem `profil.html?u=nazwa` ze zdjęciem, opisem, miastem oraz ofertami na sprzedaż i sprzedanymi.

**Aplikacja na telefon (PWA)**
- Dolne menu jak w aplikacji, instalacja na ekranie początkowym iPhone'a i Androida, szybkie ładowanie i podstawowy tryb offline.

---

## Technologie

| Warstwa | Rozwiązanie |
|---|---|
| Frontend | HTML, CSS i JavaScript bez frameworka i bez procesu budowania |
| Baza danych i konta | [Supabase](https://supabase.com) (PostgreSQL, Auth, Storage) |
| Bezpieczeństwo danych | Row Level Security: każdy użytkownik zmienia tylko swoje dane |
| Hosting | GitHub Pages (albo dowolny hosting plików statycznych) |
| Fonty | Figtree, Syne (Google Fonts) |

---

## Struktura projektu

```
obieg/
├── index.html                 strona główna z najnowszymi ofertami
├── katalog.html               katalog z filtrami
├── oferta.html                strona oferty
├── wystaw.html                dodawanie i edycja ogłoszeń
├── profil.html                publiczny profil użytkownika
├── konto.html                 moje konto: ogłoszenia, portfel, ustawienia
├── ulubione.html              zapisane oferty
├── logowanie.html             logowanie, rejestracja, reset hasła
├── regulamin.html             regulamin (do uzupełnienia)
├── polityka-prywatnosci.html  polityka prywatności (do uzupełnienia)
│
├── config.js                  dane połączenia z Supabase  ← jedyny plik do edycji
├── supabase.sql               struktura bazy, zabezpieczenia i miejsce na zdjęcia
├── db.js                      warstwa danych (konta, ogłoszenia, ulubione, portfel)
├── app.js                     wspólny interfejs (karty ofert, menu, powiadomienia)
├── consts.js                  kategorie, skala stanu, marki
├── style.css                  wygląd wszystkich stron
├── sw.js                      service worker (PWA)
├── manifest.webmanifest       ustawienia aplikacji na telefon
└── apple-touch-icon.png, icon-512.png
```

---

## Uruchomienie

### 1. Baza danych (Supabase)

1. Załóż projekt na [supabase.com](https://supabase.com). Wybierz region **Central EU (Frankfurt)**, co ułatwia zgodność z RODO.
2. Otwórz **SQL Editor → New query**, wklej całą zawartość `supabase.sql` i kliknij **Run**. Powstaną tabele, zasady bezpieczeństwa i miejsce na zdjęcia. Skrypt można bezpiecznie uruchomić ponownie.
3. W **Project Settings → API** skopiuj *Project URL* i klucz *anon public*, a potem wklej je w `config.js`:

   ```js
   window.OBIEG_CONFIG = {
     supabaseUrl: 'https://twoj-projekt.supabase.co',
     supabaseKey: 'twoj-klucz-anon-public',
     contactEmail: 'kontakt@twoja-domena.pl'
   };
   ```

   Klucz *anon public* może być jawny, bo dostęp do danych chronią zasady Row Level Security. Nigdy nie wklejaj klucza *service_role*.

4. W **Authentication → URL Configuration** ustaw:
   - **Site URL:** adres strony, np. `https://twoja-nazwa.github.io/obieg/`
   - **Redirect URLs:** ten sam adres z dopisanym `konto.html`
5. W **Authentication → Email Templates** przetłumacz maile na polski. Przed większym ruchem podłącz własną pocztę w **Authentication → SMTP** (np. Brevo lub Resend), bo wbudowana wysyłka ma niski limit.

### 2. Publikacja (GitHub Pages)

1. Wgraj wszystkie pliki do repozytorium.
2. **Settings → Pages → Deploy from a branch**, gałąź `main`, folder `/ (root)`, **Save**.
3. Po 1–2 minutach strona działa pod adresem `https://twoja-nazwa.github.io/obieg/`.

Własną domenę (np. `obieg.pl`) podepniesz w tej samej sekcji. Po zmianie adresu zaktualizuj też ustawienia z punktu 4 w Supabase.

### 3. Podgląd lokalny

Strona musi działać przez serwer, a nie z pliku otwartego bezpośrednio w przeglądarce:

```bash
cd obieg
python3 -m http.server 8000
```

Następnie otwórz `http://localhost:8000` i dodaj ten adres do *Redirect URLs* w Supabase.

---

## Baza danych

| Tabela | Zawartość | Kto może zmieniać |
|---|---|---|
| `profiles` | nazwa użytkownika, zdjęcie, opis, miasto | tylko właściciel |
| `listings` | ogłoszenia ze zdjęciami i statusem | tylko sprzedający |
| `favorites` | ulubione oferty | tylko właściciel |
| `wallet_transactions` | operacje w portfelu | tylko serwer (użytkownik czyta swoje) |
| `payout_requests` | wnioski o wypłatę | przez funkcję `request_payout`, która sprawdza saldo |

Profil tworzy się automatycznie przy rejestracji. Zdjęcia trafiają do Storage (`avatars` i `listing-photos`), a każdy użytkownik może zapisywać pliki tylko we własnym folderze.

---

## Portfel i płatności

- **Saldo** liczy się z tabeli `wallet_transactions`. Wpisy sprzedaży dodaje wyłącznie serwer. Użytkownik nie może dopisać ich sam.
- **Wnioski o wypłatę** trafiają do tabeli `payout_requests`. Przelew realizuje administrator, a potem zmienia status na `paid` w **Table Editor**.
- **Płatności od kupujących** wymagają operatora płatności dla marketplace'ów, np. Stripe Connect lub PayU Marketplace. Do czasu integracji przycisk „Kup teraz” informuje o dacie startu płatności. Nie przyjmuj pieniędzy kupujących na własne konto, bo wymagałoby to licencji instytucji płatniczej (KNF).

---

## Plan rozwoju

- [ ] Integracja płatności (Stripe Connect lub PayU) i automatyczne wpisy do portfela
- [ ] Generowanie etykiet InPost po sprzedaży
- [ ] Wiadomości między kupującym a sprzedającym
- [ ] Panel moderatora do weryfikacji ogłoszeń przed publikacją
- [ ] Oceny sprzedawców po zakończonej transakcji
- [ ] Raportowanie DAC7 dla aktywnych sprzedawców
- [ ] Aplikacja iOS (SwiftUI) korzystająca z tej samej bazy

---

## Przed startem

- [ ] Uzupełnić `regulamin.html` i `polityka-prywatnosci.html` treścią przygotowaną przez prawnika
- [ ] Wpisać adres kontaktowy w `config.js`
- [ ] Podpiąć własną domenę i własną pocztę SMTP
- [ ] Dodać stronę do [Google Search Console](https://search.google.com/search-console)

---

## Licencja

Wszelkie prawa zastrzeżone © 2026 Obieg. Kod nie jest udostępniony na licencji open source.
