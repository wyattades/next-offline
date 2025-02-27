if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register('{SW_PATH}', { scope: '{SW_SCOPE}' })
      .then(function (registration) {
        console.log('SW registered: ', registration);
      })
      .catch(function (registrationError) {
        console.log('SW registration failed: ', registrationError);
      });
  });
}
