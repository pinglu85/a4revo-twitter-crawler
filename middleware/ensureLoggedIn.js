function ensureLoggedIn({ redirectTo }) {
  return (req, res, next) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      if (req.session) {
        req.session.returnTo = req.originalUrl || req.url;
      }
      return res.redirect(redirectTo);
    }
    next();
  };
}

export default ensureLoggedIn;
