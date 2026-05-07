export const webglTrackerScript = `(function() {
  var tracker = { created: 0, lost: 0, active: 0 };
  var origGetContext = HTMLCanvasElement.prototype.getContext;

  HTMLCanvasElement.prototype.getContext = function(type) {
    var ctx = origGetContext.apply(this, arguments);
    if (ctx && (type === 'webgl' || type === 'webgl2')) {
      tracker.created++;
      tracker.active++;
      var canvas = this;
      canvas.addEventListener('webglcontextlost', function onLost() {
        canvas.removeEventListener('webglcontextlost', onLost);
        tracker.active--;
        tracker.lost++;
      });
    }
    return ctx;
  };

  window.__WEBGL_TRACKER__ = tracker;
})();`;
