```js
    "string".charAt(2); // = "r"
    "string".charAt["new_prop"]; // = undefined
    Object.defineProperty("".charAt, 'new_prop', {value: "init_value", writable: true})
    "string".charAt(2); // = "r"
    "string".charAt["new_prop"]; // = "init_value"
```

```js
    function a(param) {
        hidden_param = +this;
        console.log(hidden_param, param);
    }
    a("string") // "NaN string"
    a.bind(1,"string")(); // 1 string
```

```js
    if (~1) { // ~1 = -2
        /* Is executed, although -2 is negative */
    }
    if (~-1) { // ~-1 = 0
        /* Isn't executed */
    }
````