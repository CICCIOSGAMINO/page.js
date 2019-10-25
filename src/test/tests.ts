import globalPage, { StartOptions, Callback, Context, Page } from '../page.js';

let page = globalPage;
const expect = chai.expect;
let called = false;
let baseRoute = Function.prototype; // noop
let base = '';
let setbase = true;
let hashbang = false;
let decodeURLComponents = true;
let frame: HTMLIFrameElement|undefined;
const $ = (sel: string) => frame!.contentWindow!.document.querySelector(sel)!;

const fireEvent = (node: Node, eventName: string) => {
  const MouseEvent = (testWindow() as any).MouseEvent;
  const event = new MouseEvent(eventName, {
    bubbles: true,
    button: 1
  });
  node.dispatchEvent(event);
};

const testWindow = () => frame!.contentWindow!;

type BeforeTestsOptions = StartOptions & {
  strict?: boolean;
  base?: string;
  decodeURLComponents?: boolean;
};

const beforeTests = function(options: BeforeTestsOptions = {}, done: () => void) {
  page = new Page();

  page.route('/', function(ctx) {
    called = true;
    baseRoute(ctx);
  });

  function onFrameLoad(){
    if(setbase) {
      if (options.base) {
        page.base = options.base;
      }
      const baseTag = testWindow().document.createElement('base');
      testWindow().document.head.appendChild(baseTag);

      baseTag.setAttribute('href', (base ? base + '/' : '/'));
    }

    options.window = testWindow();
    if(options.strict != null) {
      page.strict = options.strict;
    }
    page.start(options);
    page.show(base ? base + '/' : '/');
    done();
  }

  frame = document.createElement('iframe');
  document.body.appendChild(frame);
  frame.src = './test-page.html';
  frame.addEventListener('load', onFrameLoad);
};

const replaceable = (route: string) => {
  function realCallback(ctx: Context) {
    obj.callback(ctx);
  }

  const obj = {
    callback: Function.prototype,
    replace: function(cb: Callback){
      obj.callback = cb;
    },
    once: function(cb: Callback){
      obj.replace(function(ctx){
        obj.callback = Function.prototype;
        cb(ctx, () => undefined);
      });
    }
  };

  page.route(route, realCallback);

  return obj;
};

const tests = function() {
  describe('on page load', function() {
    it('should invoke the matching callback', function() {
      expect(called).to.equal(true);
    });

    it('should invoke the matching async callbacks', function(done) {
      page.route('/async', (_ctx, next) => {
        setTimeout(() => {
          next();
        }, 10);
      }, () => {
        setTimeout(function() {
          done();
        }, 10);
      });
      page.show('/async');
    });
  });

  describe('on redirect', function() {
    it('should load destination page', function(done) {
      page.redirect('/from', '/to');
      page.route('/to', function() {
        done();
      });
      page.show('/from');
    });
    it('should work with short alias', function(done) {
      page.redirect('/one', '/two');
      page.route('/two', function() {
        done();
      });
      page.show('/one');
    });
    it('should load done within redirect', function(done) {
      page.route('/redirect', function() {
        page.redirect('/done');
      });
      page.route('/done', function() {
        done();
      });
      page.show('/redirect');
    });
  });

  describe('on exit', function() {
    it('should run when exiting the page', function(done) {
      let visited = false;
      page.route('/exit', function() {
        visited = true;
      });

      page.exit('/exit', function() {
        expect(visited).to.equal(true);
        done();
      });

      page.show('/exit');
      page.show('/');
    });

    it('should run async callbacks when exiting the page', function(done) {
      let visited = false;
      page.route('/async-exit', function() {
        visited = true;
      });

      page.exit('/async-exit', (_ctx, next) => {
        setTimeout(() => {
          next();
        }, 10);
      }, () => {
        setTimeout(() => {
          expect(visited).to.equal(true);
          done();
        }, 10);
      });

      page.show('/async-exit');
      page.show('/');
    });

    it('should only run on matched routes', function(done) {
      page.route('/should-exit', function() {});
      page.route('/', function() {});

      page.exit('/should-not-exit', function() {
        throw new Error('This exit route should not have been called');
      });

      page.exit('/should-exit', function() {
        done();
      });

      page.show('/should-exit');
      page.show('/');
    });

    it('should use the previous context', function(done) {
      let unique: {};

      page.route('/', function() {});
      page.route('/bootstrap', function(ctx) {
        unique = (ctx as any).unique = {};
      });

      page.exit('/bootstrap', function(ctx) {
        expect((ctx as any).unique).to.equal(unique);
        done();
      });

      page.show('/bootstrap');
      page.show('/');
    });
  });

  describe('no dispatch', function() {
    it('should use the previous context when not dispatching', function(done) {
      let count = 0;

      page.route('/', function() {});

      page.exit(function(context) {
        const path = context.path;
        setTimeout( function() {
          expect(path).to.equal('/');
          page.replace( '/', undefined, false, false);
          if ( count === 2 ) {
            done();
            return;
          }
          count++;
        }, 0);
      });

      page.show('/');

      page.show('/bootstrap');

      setTimeout( function() {
        page.show('/bootstrap');
      }, 0 );
    });


    after(function() {
      // remove exit handler that was added
      page.exits.pop();
    });
  });

  describe('page.back', function() {
    let first: ReturnType<typeof replaceable>;

    before(function() {
      first = replaceable('/first');
      page.route('/second', function() {});
      page.show('/first');
      page.show('/second');
    });

    it('should move back to history', function(done) {
      first.once(function(){
        let path = hashbang
          ? testWindow().location.hash.replace('#!', '')
          : testWindow().location.pathname;
        path = path.replace(base, '');
        expect(path).to.be.equal('/first');
        done();
      });

      page.back('/first');

    });

    it('should decrement page.len on back()', function() {
      const lenAtFirst = page.len;
      page.show('/second');
      page.back('/first');
      expect(page.len).to.be.equal(lenAtFirst);
    });

    it('calling back() when there is nothing in the history should go to the given path', function(done){
      page.route('/fourth', function(){
        expect(page.len).to.be.equal(0);
        done();
      });
      page.len = 0;
      page.back('/fourth');
    });

    it('calling back with nothing in the history and no path should go to the base', function(done){
      baseRoute = function(){
        expect(page.len).to.be.equal(0);
        baseRoute = Function.prototype;
        done();
      };
      page.len = 0;
      page.back();
    });
  });

  describe('ctx.querystring', function() {
    it('should default to ""', function(done) {
      page.route('/querystring-default', function(ctx) {
        expect(ctx.querystring).to.equal('');
        done();
      });

      page.show('/querystring-default');
    });

    it('should expose the query string', function(done) {
      page.route('/querystring', function(ctx) {
        expect(ctx.querystring).to.equal('hello=there');
        done();
      });

      page.show('/querystring?hello=there');
    });

    it('should accommodate URL encoding', function(done) {
      page.route('/whatever', function(ctx) {
        const expected = decodeURLComponents
          ? 'queryParam=string with whitespace'
          : 'queryParam=string%20with%20whitespace';
        expect(ctx.querystring).to.equal(expected);
        done();
      });

      page.show('/whatever?queryParam=string%20with%20whitespace');
    });
  });

  describe('ctx.pathname', function() {
    it('should default to ctx.path', function(done) {
      page.route('/pathname-default', function(ctx) {
        expect(ctx.pathname).to.equal(base + (base && hashbang ? '#!' : '') + '/pathname-default');
        done();
      });

      page.show('/pathname-default');
    });

    it('should omit the query string', function(done) {
      page.route('/pathname', function(ctx) {
        expect(ctx.pathname).to.equal(base + (base && hashbang ? '#!' : '') + '/pathname');
        done();
      });

      page.show('/pathname?hello=there');
    });

    it('should accommodate URL encoding', function(done) {
      page.route('/long path with whitespace', function(ctx) {
        expect(ctx.pathname).to.equal(base + (base && hashbang ? '#!' : '') +
          (decodeURLComponents ? '/long path with whitespace' : '/long%20path%20with%20whitespace'));
        done();
      });

      page.show('/long%20path%20with%20whitespace');
    });
  });

  describe('ctx.params', function() {
    it('should always be URL-decoded', function(done) {
      page.route('/whatever/:param', function(ctx) {
        expect(ctx.params.param).to.equal('param with whitespace');
        done();
      });

      page.show('/whatever/param%20with%20whitespace');
    });

    it('should be an object', function(done) {
      page.route('/ctxparams/:param/', function(ctx) {
        expect(ctx.params).to.not.be.an('array');
        expect(ctx.params).to.be.an('object');
        done();
      });
      page.show('/ctxparams/test/');
    });
    
    it('should handle optional first param', function(done) {
      page.route(/^\/ctxparams\/(option1|option2)?$/, function(ctx) {
        expect(ctx.params[0]).to.be.undefined;
        done();
      });
      page.show('/ctxparams/');
    });
  });

  describe('ctx.handled', function() {
    it('should skip unhandled redirect if exists', function() {
      page.route('/page/:page', function(ctx, next) {
        ctx.handled = true;
        next();
      });
      const ctx = page.show('/page/1');
      expect(ctx.handled).to.be.ok;
    });
  });

  describe('links dispatcher', function() {
    it('should invoke the callback', function(done) {
      page.route('/about', function() {
        done();
      });

      fireEvent($('.about'), 'click');
    });

    it('should handle trailing slashes in URL', function(done) {
      page.route('/link-trailing', function() {
        expect(page.strict).to.equal(false);
        done();
      });
      page.route('/link-trailing/', function() {
        expect(page.strict).to.equal(true);
        done();
      });
      fireEvent($('.link-trailing'), 'click');
    });

    it('should handle trailing slashes in route', function(done) {
      page.route('/link-no-trailing/', function() {
        expect(page.strict).to.equal(false);
        done();
      });
      page.route('/link-no-trailing', function() {
        expect(page.strict).to.equal(true);
        done();
      });
      fireEvent($('.link-no-trailing'), 'click');
    });

    it('should invoke the callback with the right params', function(done) {
      page.route('/contact/:name', function(ctx) {
        expect(ctx.params.name).to.equal('me');
        done();
      });
      fireEvent($('.contact-me'), 'click');
    });

    it('should not invoke the callback', function() {
      page.route('/whoop', (_ctx) => {
        expect(true).to.equal(false);
      });
      fireEvent($('.whoop'), 'click');
    });

    it('should not fire when navigating to a different domain', function(done){
      page.route('/diff-domain', (_ctx) => {
        expect(true).to.equal(false);
      });

      testWindow().document.addEventListener('click', function onDocClick(ev){
        ev.preventDefault();
        testWindow().document.removeEventListener('click', onDocClick);
        done();
      });

      fireEvent($('.diff-domain'), 'click');
    });

    it('works with shadow paths', function() {
      page.route('/shadow', function() {
        expect(true).to.equal(true);
        page.show('/');
      });

      fireEvent($('.shadow-path'), 'click');
    });
  });

  describe('dispatcher', function() {
    it('should ignore query strings', function(done) {
      page.route('/qs', (_ctx) => {
        done();
      });

      page.show('/qs?test=true');
    });

    it('should ignore query strings with params', function(done) {
      page.route('/qs/:name', function(ctx) {
        expect(ctx.params.name).to.equal('tobi');
        done();
      });

      page.show('/qs/tobi?test=true');
    });

    it('should invoke the matching callback', function(done) {
      page.route('/user/:name', (_ctx) => {
        done();
      });

      page.show('/user/tj');
    });

    it('should handle trailing slashes in path', function(done) {
      page.route('/no-trailing', function() {
        expect(page.strict).to.equal(false);
        done();
      });
      page.route('/no-trailing/', function() {
        expect(page.strict).to.equal(true);
        done();
      });
      page.show('/no-trailing/');
    });

    it('should handle trailing slashes in route', function(done) {
      page.route('/trailing/', function() {
        expect(page.strict).to.equal(false);
        done();
      });
      page.route('/trailing', function() {
        expect(page.strict).to.equal(true);
        done();
      });
      page.show('/trailing');
    });

    it('should populate ctx.params', function(done) {
      page.route('/blog/post/:name', function(ctx) {
        expect(ctx.params.name).to.equal('something');
        done();
      });

      page.show('/blog/post/something');
    });

    it('should not include hash in ctx.pathname', function(done){
      page.route('/contact', function(ctx){
        expect(ctx.pathname).to.equal('/contact');
        done();
      });

      page.show(hashbang ? '/contact' : '/contact#bang');
    });

    describe('when next() is invoked', function() {
      it('should invoke subsequent matching middleware', function(done) {

        let visistedFirst = false;
        page.route('/forum/*', (_ctx, next) => {
          visistedFirst = true;
          next();
        });

        page.route('/forum/:fid/thread/:tid', (_ctx) => {
          expect(visistedFirst).to.equal(true);
          done();
        });

        page.show('/forum/1/thread/2');
      });
    });

    describe('not found', function() {
      it('should invoke the not found callback', function(done) {
        page.route(function() {
          done();
        });
        page.show('/whathever');
      });
    });
  });
};

const afterTests = function() {
  called = false;
  page.stop();
  page.base = '';
  page.strict = false;
  //page.show('/');
  base = '';
  baseRoute = Function.prototype; // noop
  setbase = true;
  decodeURLComponents = true;
  document.body.removeChild(frame!);
};

describe('Html5 history navigation', function() {

  before(function(done) {
    beforeTests(undefined, done);
  });

  tests();

  it('Should dispatch when going to a hash on same path', function(done){
    let cnt = 0;
    page.route('/query', function(){
      cnt++;
      if(cnt === 2) {
        done();
      }
    });

    fireEvent($('.query'), 'click');
    fireEvent($('.query-hash'), 'click');
  });

  after(function() {
    afterTests();
  });

});

describe('Configuration', function() {
  before(function(done) {
    beforeTests(undefined, done);
  });

  it('Can disable popstate', function() {
    page.configure({ popstate: false });
  });

  it('Can disable click handler', function() {
    page.configure({ click: false });
  });

  after(function() {
    afterTests();
  });
});

describe('Hashbang option enabled', function() {

  before(function(done) {
    hashbang = true;
    beforeTests({
      hashbang: hashbang
    }, done);
  });

  tests();

  it('Using hashbang, url\'s pathname not included in path', function(done){
    page.stop();
    baseRoute = function(ctx: Context){
      expect(ctx.path).to.equal('/');
      done();
    };
    page.start({ hashbang: true, window: testWindow() });
  });

  after(function() {
    hashbang = false;
    afterTests();
  });

});

describe('Different Base', function() {

  before(function(done) {
    base = '/newBase';
    beforeTests({
      base: '/newBase'
    }, done);
  });

  tests();

  after(function() {
    afterTests();
  });

});

describe('URL path component decoding disabled', function() {
  before(function(done) {
    decodeURLComponents = false;
    beforeTests({
      decodeURLComponents: decodeURLComponents,
    }, done);
  });

  tests();

  after(function() {
    afterTests();
  });
});

describe('Strict path matching enabled', function() {
  before(function(done) {
    beforeTests({
      strict: true
    }, done);
  });

  tests();

  after(function() {
    afterTests();
  });
});

describe('.clickHandler', function() {
  it('is exported by the global page', function() {
    expect(typeof page.clickHandler).to.equal('function');
  });
});
