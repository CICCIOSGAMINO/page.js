
/**
 * Expose `pathToRegexp`.
 */
export default pathToRegexp;

pathToRegexp.parse = parse
pathToRegexp.compile = compile
pathToRegexp.tokensToFunction = tokensToFunction
pathToRegexp.tokensToRegExp = tokensToRegExp

/**
 * The main path matching regexp utility.
 */
const PATH_REGEXP = new RegExp([
  // Match escaped characters that would otherwise appear in future matches.
  // This allows the user to escape special characters that won't transform.
  '(\\\\.)',
  // Match Express-style parameters and un-named parameters with a prefix
  // and optional suffixes. Matches appear as:
  //
  // "/:test(\\d+)?" => ["/", "test", "\d+", undefined, "?", undefined]
  // "/route(\\d+)"  => [undefined, undefined, undefined, "\d+", undefined, undefined]
  // "/*"            => ["/", undefined, undefined, undefined, undefined, "*"]
  '([\\/.])?(?:(?:\\:(\\w+)(?:\\(((?:\\\\.|[^()])+)\\))?|\\(((?:\\\\.|[^()])+)\\))([+*?])?|(\\*))'
].join('|'), 'g')

interface Token {
  name: string | number;
  prefix: string;
  delimiter: string;
  optional: boolean;
  repeat: boolean;
  pattern: any;
}

/**
 * Parse a string for the raw tokens.
 */
function parse (str: string): Array<string|Token> {
  const tokens: Array<string|Token> = [];
  let key = 0;
  let index = 0;
  let path = '';
  let res;

  while ((res = PATH_REGEXP.exec(str)) != null) {
    const m = res[0];
    const escaped = res[1];
    const offset = res.index;
    path += str.slice(index, offset)
    index = offset + m.length

    // Ignore already escaped sequences.
    if (escaped) {
      path += escaped[1]
      continue
    }

    // Push the current path onto the tokens.
    if (path) {
      tokens.push(path)
      path = ''
    }

    const prefix = res[2];
    const name = res[3];
    const capture = res[4];
    const group = res[5];
    const suffix = res[6];
    const asterisk = res[7];

    const repeat = suffix === '+' || suffix === '*';
    const optional = suffix === '?' || suffix === '*';
    const delimiter = prefix || '/';
    const pattern = capture || group || (asterisk ? '.*' : '[^' + delimiter + ']+?');

    tokens.push({
      name: name || key++,
      prefix: prefix || '',
      delimiter: delimiter,
      optional: optional,
      repeat: repeat,
      pattern: escapeGroup(pattern)
    })
  }

  // Match any characters still remaining.
  if (index < str.length) {
    path += str.substr(index)
  }

  // If the path exists, push it onto the end.
  if (path) {
    tokens.push(path)
  }

  return tokens
}

/**
 * Compile a string to a template function for the path.
 */
function compile (str: string) {
  return tokensToFunction(parse(str))
}

/**
 * Expose a method for transforming tokens into the path function.
 */
function tokensToFunction (tokens: Array<string|Token>) {
  // Compile all the tokens into regexps.
  const matches = new Array(tokens.length);

  // Compile all the patterns before compilation.
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (typeof token !== 'string') {
      matches[i] = new RegExp('^' + token.pattern + '$');
    }
  }

  return function (obj: {}) {
    let path = '';
    const data: any = obj || {};

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if (typeof token === 'string') {
        path += token;
        continue;
      }

      const value: unknown = data[token.name];
      let segment: string;

      if (value == null) {
        if (token.optional) {
          continue;
        } else {
          throw new TypeError('Expected "' + token.name + '" to be defined');
        }
      }

      if (Array.isArray(value)) {
        if (!token.repeat) {
          throw new TypeError('Expected "' + token.name + '" to not repeat, but received "' + value + '"');
        }

        if (value.length === 0) {
          if (token.optional) {
            continue;
          } else {
            throw new TypeError('Expected "' + token.name + '" to not be empty');
          }
        }

        for (let j = 0; j < value.length; j++) {
          segment = encodeURIComponent(value[j]);

          if (!matches[i].test(segment)) {
            throw new TypeError('Expected all "' + token.name + '" to match "' + token.pattern + '", but received "' + segment + '"');
          }

          path += (j === 0 ? token.prefix : token.delimiter) + segment
        }

        continue;
      }

      segment = encodeURIComponent(value as string);

      if (!matches[i].test(segment)) {
        throw new TypeError('Expected "' + token.name + '" to match "' + token.pattern + '", but received "' + segment + '"');
      }

      path += token.prefix + segment;
    }

    return path;
  }
}

/**
 * Escape a regular expression string.
 */
const escapeString = (str: string) => str.replace(/([.+*?=^!:${}()[\]|\/])/g, '\\$1');

/**
 * Escape the capturing group by escaping special characters and meaning.
 */
const escapeGroup = (group: string) => group.replace(/([=!:$\/()])/g, '\\$1');

/**
 * Attach the keys as a property of the regexp.
 */
function attachKeys (re: RegExp, keys: Array<string|Token>) {
  (re as any).keys = keys;
  return re;
}

interface Options {
  sensitive?: boolean;
  strict?: boolean;
  end?: boolean;
}

/**
 * Get the flags for a regexp from the options.
 *
 * @param  {Object} options
 * @return {String}
 */
const flags = (options: Options) => options.sensitive ? '' : 'i';

/**
 * Pull out keys from a regexp.
 */
function regexpToRegexp (path: RegExp, keys: Array<string|Token>) {
  // Use a negative lookahead to match only capturing groups.
  const groups = path.source.match(/\((?!\?)/g);

  if (groups) {
    for (let i = 0; i < groups.length; i++) {
      keys.push({
        name: i,
        prefix: null,
        delimiter: null,
        optional: false,
        repeat: false,
        pattern: null
      });
    }
  }

  return attachKeys(path, keys);
}

/**
 * Transform an array into a regexp.
 */
function arrayToRegexp(path: Array<string>, keys: Array<string|Token>, options?: Options) {
  const parts = [];

  for (const segment of path) {
    parts.push(pathToRegexp(segment, keys, options).source);
  }

  const regexp: RegExp = new RegExp('(?:' + parts.join('|') + ')', flags(options));

  return attachKeys(regexp, keys);
}

/**
 * Create a path regexp from string input.
 */
function stringToRegexp(path: string, keys: Array<string|Token>, options?: Options) {
  const tokens = parse(path);
  const re = tokensToRegExp(tokens, options);

  // Attach keys back to the regexp.
  for (const token of tokens) {
    if (typeof token !== 'string') {
      keys.push(token);
    }
  }

  return attachKeys(re, keys);
}

/**
 * Expose a function for taking tokens and returning a RegExp.
 */
function tokensToRegExp (tokens: Array<string|Token>, options: Options = {}) {
  const strict = options.strict;
  const end = options.end !== false;
  const lastToken = tokens[tokens.length - 1];
  const endsWithSlash = typeof lastToken === 'string' && /\/$/.test(lastToken);
  let route = '';

  // Iterate over the tokens and create our regexp string.
  for (const token of tokens) {
    if (typeof token === 'string') {
      route += escapeString(token);
    } else {
      const prefix = escapeString(token.prefix);
      let capture = token.pattern;

      if (token.repeat) {
        capture += '(?:' + prefix + capture + ')*';
      }

      if (token.optional) {
        if (prefix) {
          capture = '(?:' + prefix + '(' + capture + '))?';
        } else {
          capture = '(' + capture + ')?';
        }
      } else {
        capture = prefix + '(' + capture + ')';
      }

      route += capture;
    }
  }

  // In non-strict mode we allow a slash at the end of match. If the path to
  // match already ends with a slash, we remove it for consistency. The slash
  // is valid at the end of a path match, not in the middle. This is important
  // in non-ending mode, where "/test/" shouldn't match "/test//route".
  if (!strict) {
    route = (endsWithSlash ? route.slice(0, -2) : route) + '(?:\\/(?=$))?'
  }

  if (end) {
    route += '$';
  } else {
    // In non-ending mode, we need the capturing groups to match as much as
    // possible by using a positive lookahead to the end or next path segment.
    route += strict && endsWithSlash ? '' : '(?=\\/|$)';
  }

  return new RegExp('^' + route, flags(options));
}

/**
 * Normalize the given path string, returning a regular expression.
 *
 * An empty array can be passed in for the keys, which will hold the
 * placeholder key descriptions. For example, using `/user/:id`, `keys` will
 * contain `[{ name: 'id', delimiter: '/', optional: false, repeat: false }]`.
 */
function pathToRegexp (path: string|RegExp|Array<string>, keys: Array<string|Token>, options?: Options) {
  keys = keys || [];

  if (!Array.isArray(keys)) {
    options = keys;
    keys = [];
  } else if (!options) {
    options = {};
  }

  if (path instanceof RegExp) {
    return regexpToRegexp(path, keys);
  }

  if (Array.isArray(path)) {
    return arrayToRegexp(path, keys, options)
  }

  return stringToRegexp(path, keys, options)
}
