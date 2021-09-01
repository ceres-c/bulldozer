| Pos | Descr | Value |
| ------ | ----- | ------ |
| 0 | Chrome data (array) | Actual system call results |
| 3 | Is the device's battery currently being charged? | boolean |
| 7 | Touch info | `true` if touch "can be supported", `false` otherwise. First they check if a touchscreen is reported via `"ontouchstart" in window.document`, then check if `window.navigator.platform` is contained in `arm\|iphone\|ipad\|ipod` |
| 8 | Firefox promise timestamp | Empty string if on any other browser |
| 12 | Initialization timestamp |
| 13 | Counter of ??? |
| 16 | Automation detector |<ul><li>`1` if the strings `pageJavascriptEnabled` or `IntersectionObserver` are in `e` function's caller</li> <li>`0` otherways</li></ul>|
| 23 | Firefox data (number) | `window.mozPaintCount << 1 \| window.mozInnerScreenX << 2 \| window.debug << 3 \| window.WebKitPlaybackTargetAvailabilityEvent << 4` |
| 24 | set to 0 after 44 has been populated |
| 25 | AudioContext object | |
| 27 | contains a function to check whether two objects are not equal |
| 28 | `console.log` configuration |<ul><li>Init `0`</li><li>`1` if window.console.context is present</li><li>`253` if window.console.log.prototype exists</li><li>`254` if window.console.log is not found</li></ul> |
| 31 | set to 0 after 44 has been populated |
| 33 | WebGL renderer position in array 55 (see 55) | number |
| 35 | Chrome data (array) | Tries to get `[window.chrome.history, window.chrome.bookmarks, window.chrome.system.storage, window.chrome.cookies]`. If any of these can be found, its value in this array will be set to `2`, resulting in `[2,2,2,2]` if all the information are retrieved. System call results are not saved anywhere. Defaults to `[1,1,1,1]` |
| 38 | Current percentage of the device's battery | number (0 < x < 100) |
| 40 | Set to 1 if `window.workbench` is not found (see 71)
| 41 | Contains information about WebGL | Can be: <ul><li>`3` if platform is contained in `"iPhoneiPadiPod"` (WebGL tracking not performed in this case)</li><li>`1` if WebGL tracking info was correctly retrieved</li><li>`0` if it was impossible to get WebGL info</li></ul>|
| 44 | Array of tracking data, as per `Dn` table below | This array will be "encrypted" and sent to the server (?) |
| 45 | Body size of collina XOR init timestamp | `window.performance.getEntriesByName(src)[0].decodedBodySize ^ init_timestamp` |
| 48 | Anti tampering timestamp (scrambled according to below snippet) | array of numbers |
| 50 | Battery info fetch status | Can be: <ul><li>`2` battery data can be fetched, but not retrieved yet</li><li>`1` battery data correctly retrieved (3 and 38 populated as well)</li><li>`undefined` if it was impossible to get battery data</li></ul> |
| 55 | WebGL information array | array of strings (`["Google Inc. (Intel)", "ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6 (Core Profile) Mesa 21.1.6)"]`). Index of elements are saved in 35 and 69 |
| 58 | set to 0 after 44 has been populated |
| 65 | Automation detector |<ul><li>`1` if the strings `getNodeRootThroughAnyShadows` is in `e` function's caller</li> <li>`0` otherways</li></ul>|
| 67 | Comma separated values from audio fingerprint | `AnalyserNode["getFloatFrequencyData"](Float32Array)` |
| 69 | WebGL vendor position in array 55 (see 55) | number |
| 71 | Value of ??? | Init to `253`, search `attempt` in something and then <ul><li>`255` currently not reversed</li><li>`254` currently not reversed</li><li>`252` if window.workbench is present (probably something related to their SDK)</li><li>`1` if window.workbench if not present</li></ul> (See 40)|
| 72 | `setUM` target |
| 73 | Firefox promise timestamp |

# Dn
| Data | notes |
| ------ | ------ |
| `Ce` |
| `mn` |
| `255 & global_storage[66]` |
| `255 & global_storage[11]` |
| length of `window.navigator.buildID` (truncated to 255) |
| array of numbers, ascii representation of `window.navigator.buildID` (truncated to 255 chars) |
| `window.ScriptEngineBuildVersion` (split in two 8-bit numbers) | `[0,0]` with browsers other than IE |
| `window.ScriptEngineMajorVersion` | `0` with browsers other than IE |
| `window.ScriptEngineMinorVersion` | `0` with browsers other than IE |
| `8` | Fixed value (length of upcoming data) |
| `mn2` split in a 4 byte array | If using IE `[0,0,0,0]` |
| `mn3` split in a 4 byte array | If using IE `[0,0,0,0]` |

## Ce
Bitmask of:
| bit position | value| notes |
| ------ | ----- | ----- |
| 0 | `!!window["webkitRTCPeerConnection"] \|\| !!(G)` | `G` can be the generic `window.Element.prototype` or, if available, `window.Element.prototype.webkitMatchesSelector` |
| 1 | `window["mozPaintCount"]` |
| 2 | `window["mozInnerScreenX"] !== void 0` |
| 3 | `!!window["debug"]` |
| 4 | `!!window["WebKitPlaybackTargetAvailabilityEvent"]` |

## mn
Bitmask of:
| bit position | value|
| ------ | ----- |
| 0 | `window["__wxjs_environment"] === "miniprogram"` |
| 1 | `P[__wxjs_environment] === "browser"` |
| 2 | `!!window["WindVane"] && !!window["WindVane"]["isAvailables"]` |
| 3 | `!!window["AlipayJSBridge"]` |
| 4 | `!!window["WeixinJSBridge"]` |
| 5 | `!!~window.location.href.indexOf("pc_native=1")` |
| 6 | `!!~window.location.href.indexOf("tmd_nc=1")` |
| 7 | `!!~window.location.href.indexOf("&native=1")` |

## mn2
Bitmask of browser features:
| bit position | value|
| ------ | ----- |
| 0 | `window.Symbol.hasOwnProperty("species")` |
| 1 | `window.hasOwnProperty("Reflect")` |
| 2 | `window.Symbol.hasOwnProperty("toPrimitive")` |
| 3 | `window.WeakMap.prototype.hasOwnProperty("clear")` |
| 4 | `window.DOMTokenList.prototype.hasOwnProperty("replace")` |
| 5 | `window.Symbol.hasOwnProperty("hasInstance")` |
| 6 | `window.hasOwnProperty("isSecureContext")` |
| 7 | `window.self.hasOwnProperty("origin")` |
| 8 | `window.PerformanceTiming.prototype.hasOwnProperty("secureConnectionStart")` |
| 9 | `window.hasOwnProperty("showModalDialog")` |
| 10 | `window.HTMLDocument.prototype.hasOwnProperty("getSelection")` |
| 11 | `window.HTMLMediaElement.prototype.hasOwnProperty("mozAutoplayEnabled")` |

## mn3
Bitmask of browser features:
| bit position | value|
| ------ | ----- |
| 0 | `!![]["copyWithin"]` (Check if array has method `copyWithin`) |
| 1 | `!![]["includes"]` (Check if array has method `includes`) |
| 2 | `window.hasOwnProperty("Touch")`
| 3 | `window.hasOwnProperty("Proxy")` |
| 4 | `window.Symbol.hasOwnProperty("match")` |
| 5 | `Xo = function() {}; !!Xo.name` |
| 6 | `window.Object.hasOwnProperty("values")` |
| 7 | `window.OfflineAudioContext.prototype.hasOwnProperty("close")` |
| 8 | UNUSED |
| 9 | `!!"".padStart` |
| 10 | `window.PointerEvent.prototype.hasOwnProperty("getCoalescedEvents")` |
| 11 | UNUSED |
| 12 | `window.hasOwnProperty("BudgetService")` |
| 13 | `!!window.document.createElement("canvas") && !!window.document.createElement("canvas").getAttributeNames` |
| 14 | `!!window.performance && !!window.performance.timeOrigin !== void 0` |
| 15 | `window.Intl.hasOwnProperty("PluralRules")` |
| 16 | `window.hasOwnProperty("getMatchedCSSRules")` |
| 17 | `window.hasOwnProperty("PerformanceServerTiming")` |
| 18 | `!![]["values"]` (Check if array has method `values`) |
| 19 | `window.hasOwnProperty("BigInt")` |
| 20 | `window.document.wasDiscarded !== void 0` |
| 21 | `window.hasOwnProperty("OffscreenCanvas")` |
| 22 | `window.hasOwnProperty("globalThis")` |
| 23 | `window.Intl.hasOwnProperty("ListFormat")` |
| 24 | `window.Object.hasOwnProperty("fromEntries")` |
| 25 | `window.Intl.hasOwnProperty("Locale")` |
| 26 | `window.MediaStreamTrack.prototype.hasOwnProperty("getCapabilities")` |
| 27 | `window.Promise.hasOwnProperty("allSettled")` |
| 28 | `window.hasOwnProperty("FormDataEvent")` |

# Timestamp anti tampering
```js
    result = []

    date = 1629380095285 // JS timestamp in milliseconds

    divider = 4294967296 // 2^32
    integer_part = 0 | (date / divider); // Make division integer
    whole = integer_part * divider; // multiplying again, whole is the closest whole number to timestamp
    remainder = date - whole;

    p1 = 255 & integer_part;
    s_2 = integer_part >> 8;
    p2 = 255 & s_2;
    s_3 = integer_part >> 16;
    p3 = 255 & s_3;
    s_4 = integer_part >> 24;
    p4 = 255 & s_4;

    result.push(p4, p3, p2, p1);

    p5 = 255 & remainder;
    s_6 = remainder >> 8;
    p6 = 255 & s_6;
    s_7 = remainder >> 16;
    p7 = 255 & s_7;
    s_8 = remainder >> 24;
    p8 = 255 & s_8;

    result.push(p8, p7, p6, p5);
```