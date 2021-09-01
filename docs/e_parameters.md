`e` function parameters

# `this`
with chrome-data:
| value | behavior |
| ------ | ----- |
| 0 | history |
| 1 | bookmarks |
| 2 | storage |
| 3 | cookies |

# r
| value | behavior |
| ------ | ----- |
| 0 | Clear the action of one parameter in this list, which is passed as 2nd element. If no 2nd element is passed, will return "Not supported" |
| 1 | `getUA` |
| 2 | Register element callbacks in the window (?) |
| 4 | `decryptJSON` |
| 5 | `getBattery` callback on promise rejection (possibly all the promises) - seems to be not actually handled |
| 6 | Return a callback handler (?) |
| 7 | Check console support/tampering |
| 8 | `setUM` |
| 9 | `getBattery` callback on success |
| 10 | Working with chrome-data (other parameter is passed as `this`) |
| 11 | Calls `s(7)` where `s` is the second parameter passed to function `e`. This will never (?) be called since the only call in the code is via a bind `(0, 11)` which lacks the second parameter. |
| 12 | Set `global_storage[59]=1`, `global_storage[63]=0`, `global_storage[8]=""` |
| 13 | `isReadyForSC` |
| 14 | Stack-based string decoder |
| 16 | Save audio fingerprint data |
| 17 | Canvas fingerprint |
| 18 | Increments `"".charAt.value` counter by one, if it was `1` before incrementing, clears `global_storage[8]` (firefox data) |
| 19 | Instantiate a function in `global_storage[27]` to check if two objects equal |
| 21 | Increments `global_storage[13]` by one |
| 23 | Unknown, something mobile-specific, possibly Apple only. Returns the fingerprint data in a bitmask number |
| 25 | `resetSA` |
| 27 | Initialize collina |
| 28 | Unknown, has to be called with all the e function's parameter populated |