# Acceptance checklist (AUCTION_SPEC.md section 14)

Checked on 23 Nov 2026 against commit `2dc22b5` plus the tests added in this pass. Every item points at the test that proves it. Run them with `npm test`, and the phone-size smoke test with `npm run e2e`.

Test files: engine `packages/engine/test/`, server `apps/server/test/`, end to end `e2e/smoke.spec.ts`.

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | 2-team all-4-3-3 pool is 40 (22 + 18), 12-team is 154 (132 + 22), mixed formations follow the formula | Pass | engine `pool.test` "builds the spec example pool sizes", "follows the formula for mixed formations"; server `season.test` "league size" builds 40 and 154 in real games |
| 2 | Changing a formation or adding a team updates the pool preview live | Pass | server `realtime.test` "pushes the new pool preview live when a team joins or changes formation" (new); `games.test` lobby tests |
| 3 | 12 teams with exactly 8 AI clubs, 2 teams with 18; always 20 teams and 380 fixtures over 38 matchdays | Pass | server `season.test` "league size" for 2 and 12 teams, through a whole season (new); engine `botAuction.test`, `season.test` fixtures |
| 4 | Pool never has a woman's player, a duplicate id, or a group short of need plus extra | Pass, with a note | Duplicates and group sizes: engine `assignment.test` "has the top 20 of every position..." (new), `data.test`, `pool.test` worst case; server `games.test` start (unique pool ids). Women's players: the supplied data has no gender column; the spec says the 571 players are men's players with women's excluded, and `data/` must not be regenerated, so this rests on the data source |
| 5 | Top 20 of every position are in the master data and, for 12 teams, in the pool | Pass | engine `assignment.test` "has the top 20 of every position in the master data, and the best of each group in every 12-team pool" (new): ranks 1 to 20 exist for all 12 groups; in four 12-team formation mixes every group takes its best players, the whole top 20 wherever the group's pool holds 20 or more |
| 6 | Prices match the formula (91: 133 and 67; 80: 60 and 30) | Pass | engine `pricing.test` "matches the spec table"; `data.test` price check |
| 7 | Every team starts with the budget; money never below zero | Pass | server `games.test` start (budgets), `season.test` "league size" (1,000 each, never negative after auto-fill), `auction.test` auto end; engine stall guard test |
| 8 | Bid for a player with no open slot is rejected (`NO_SLOT`) | Pass | server and engine `auction.test` NO_SLOT tests |
| 9 | A striker cannot keep goal, a left-back cannot play CB | Pass | engine `lineup.test` "never lets a striker keep goal or a left-back play centre-back" |
| 10 | Messi (CAM; ST, RW, RM) fits CAM, ST, RW or RM slots, not CB | Pass | engine `lineup.test`, `auction.test` "accepts Messi for an open ST slot but not for an open CB slot", `data.test` alternates |
| 11 | `WOULD_STRAND_TEAM` is rejected; every auction finishes with valid XIs | Pass | engine `auction.test` feasibility tests, `botAuction.test` (2, 3 and 12 teams, every bot level); server auto end |
| 12 | Slot assignment maximizes main positions; legal swaps work | Pass | engine `lineup.test` assignLineup and swapSlots; server `auction.test` swap |
| 13 | Reserve rule blocks the bid; the UI shows the right max bid | Pass | engine `auction.test` reserve rule (including the UI max bid); server "applies the reserve rule" checks the max bid the room shows is exactly the limit |
| 14 | Simultaneous bids are ordered; the loser gets OUTBID and keeps its turn | Pass | server and engine "orders two simultaneous bids" |
| 15 | Nomination out of turn is rejected | Pass | server and engine out-of-turn tests |
| 16 | Anti-snipe: a bid with 3 s left resets the clock to 10 s | Pass | server `auction.test` "resets the clock to the anti-snipe time" (3 s left becomes 10 s) |
| 17 | Nomination timer expiry auto-nominates a legal player at base price | Pass | server `auction.test` "auto-nominates the best legal player at base price"; engine auto-nomination test |
| 18 | Host pauses at any moment, including mid-lot; everything freezes; resume restores the exact time | Pass | server `auction.test` "freezes a live lot..." (mid-lot, survives a restart), "pauses between lots too" (new), and the countdown pause in the auto end test |
| 19 | A non-host cannot pause | Pass | server `auction.test` pause test (`HOST_ONLY`) |
| 20 | The last purchase ends the auction, marks unsold players and starts the season after the reveal countdown | Pass | server `auction.test` "ends the auction automatically", `season.test` "simulates and saves the whole season when the reveal countdown runs out"; e2e smoke test |
| 21 | The stall guard auto-fills a stuck team and the auction still finishes | Pass | engine `auction.test` "auto-fills a team that cannot afford anything", `botAuction.test` completion |
| 22 | Refreshing mid-auction restores the exact state, live lot and time left | Pass | server `auction.test` "restores the exact live lot and time left on a refresh or a server restart" (new) |
| 23 | A disconnected human is replaced by a bot or put on auto-nominate, as the host chooses | Pass | server `auction.test` "hands a disconnected manager's team to a bot, and back", "can put a team on auto-nominate only" (new) |
| 24 | Remove-bought-players: no bought star in an AI XI, every AI club fields 11 | Pass | engine `botAuction.test`, `clubs.test`; server `season.test` checks no bought player is in an AI XI |
| 25 | Same seed, same results; another seed differs | Pass | engine `season.test`, `botAuction.test`; server "is fully reproducible from the stored seed" |
| 26 | Points are 3 x wins + draws; total goals for equal goals against | Pass | engine `season.test` "keeps the table invariants"; server season view checks |
| 27 | 38 matches each, 19 home and 19 away, every opponent twice | Pass | engine `season.test` fixtures; server `season.test` "league size" (new) |
| 28 | Monte Carlo (1,000 seasons) finishes with plausible title chances | Pass | engine `season.test` "runs 1,000 seasons and gives plausible title chances" |
| 29 | A normal user is refused at /admin and on admin endpoints | Pass | server `admin.test` "refuses every admin endpoint to anonymous visitors, users and guests"; the web guard was checked in the browser in M6 |
| 30 | Auction room and season playback usable on a phone | Pass | e2e smoke test runs the whole game at Pixel 7 size; checked by hand at 375 px wide in M3, M4 and M7 |
| 31 | No official logos or player photos; the fan game footer is present | Pass | The only image in the web app is the locally generated lobby QR code; badges are colours and monograms; no external image URLs. The footer is on every page and the e2e test checks it |
| 32 | `npm test`, `npm run typecheck`, `npm run lint` pass | Pass | 272 tests (engine 129, protocol 13, server 130), typecheck and lint clean |

## Not covered by this pass

- The Docker image has not been built here (Docker is not installed on this machine). Its steps were run in a clean copy of the repo; see DECISIONS.md, M7.
