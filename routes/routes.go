package routes

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/handlers"
	googlecontroller "github.com/m-barthelemy/vpn-webauth/controllers/google"
	otcController "github.com/m-barthelemy/vpn-webauth/controllers/otc"
	otpController "github.com/m-barthelemy/vpn-webauth/controllers/otp"
	sseController "github.com/m-barthelemy/vpn-webauth/controllers/sse"
	vpnController "github.com/m-barthelemy/vpn-webauth/controllers/vpn"
	webauthNController "github.com/m-barthelemy/vpn-webauth/controllers/webauthn"
	"github.com/m-barthelemy/vpn-webauth/models"
	"github.com/markbates/pkger"
	"gorm.io/gorm"
)

func New(config *models.Config, db *gorm.DB) http.Handler {
	tokenSigningKey := []byte(config.SigningKey)

	// Prepare embedded templates
	dir := pkger.Include("/templates")
	tplHandler := NewTemplateHandler(config)
	err := tplHandler.CompileTemplates(dir)
	if err != nil {
		log.Fatalf("Error compiling templates: %s", err.Error())
	}
	mux := http.NewServeMux()

	mux.HandleFunc("/assets/", tplHandler.HandleStaticAsset)
	mux.HandleFunc("/fonts/", tplHandler.HandleStaticAsset)
	mux.HandleFunc("/font/", tplHandler.HandleStaticAsset)
	mux.HandleFunc("/favicon.ico", tplHandler.HandleStaticAsset) // Avoid it being treated like a template throwing errors in logs

	mux.HandleFunc("/", tplHandler.HandleEmbeddedTemplate)

	googleC := googlecontroller.New(db, config)
	//mux.HandleFunc("/auth/google/login", googleC.OauthGoogleLogin)
	mux.Handle("/auth/google/login",
		handlers.LoggingHandler(
			os.Stdout,
			http.HandlerFunc(sessionMiddleware(tokenSigningKey, googleC.OauthGoogleLogin, true)),
		),
	)
	mux.Handle("/auth/google/callback",
		handlers.LoggingHandler(
			os.Stdout,
			http.HandlerFunc(googleC.OauthGoogleCallback),
		),
	)

	mux.Handle("/auth/getmfachoice",
		handlers.LoggingHandler(
			os.Stdout,
			http.HandlerFunc(sessionMiddleware(tokenSigningKey, googleC.GetMFaChoosePage, true)),
		),
	)

	otpC := otpController.New(db, config)
	// This creates the OTP provider (and secret) for the User
	mux.Handle("/auth/otp/qrcode",
		handlers.LoggingHandler(
			os.Stdout,
			http.HandlerFunc(sessionMiddleware(tokenSigningKey, otpC.GenerateQrCode, false)),
		),
	)
	mux.Handle("/auth/otp/validate",
		handlers.LoggingHandler(
			os.Stdout,
			http.HandlerFunc(sessionMiddleware(tokenSigningKey, otpC.ValidateOTP, false)),
		),
	)

	webauthnC := webauthNController.New(db, config)
	mux.Handle("/auth/webauthn/beginregister",
		handlers.LoggingHandler(
			os.Stdout,
			http.HandlerFunc(sessionMiddleware(tokenSigningKey, webauthnC.BeginRegister, false)),
		),
	)
	mux.Handle("/auth/webauthn/finishregister",
		handlers.LoggingHandler(
			os.Stdout,
			http.HandlerFunc(sessionMiddleware(tokenSigningKey, webauthnC.FinishRegister, false)),
		),
	)
	mux.Handle("/auth/webauthn/beginlogin",
		handlers.LoggingHandler(
			os.Stdout,
			http.HandlerFunc(sessionMiddleware(tokenSigningKey, webauthnC.BeginLogin, false)),
		),
	)
	mux.Handle("/auth/webauthn/finishlogin",
		handlers.LoggingHandler(
			os.Stdout,
			http.HandlerFunc(sessionMiddleware(tokenSigningKey, webauthnC.FinishLogin, false)),
		),
	)

	otcC := otcController.New(db, config)
	mux.Handle("/auth/code/generate",
		handlers.LoggingHandler(
			os.Stdout,
			http.HandlerFunc(sessionMiddleware(tokenSigningKey, otcC.GenerateSingleUseCode, false)),
		),
	)
	mux.Handle("/auth/code/validate",
		handlers.LoggingHandler(
			os.Stdout,
			http.HandlerFunc(sessionMiddleware(tokenSigningKey, otcC.ValidateSingleUseCode, false)),
		),
	)

	vpnC := vpnController.New(db, config)
	mux.Handle("/vpn/check",
		handlers.LoggingHandler(
			os.Stdout,
			http.HandlerFunc(vpnC.CheckSession),
		),
	)

	// Make a new Broker instance
	sseC := sseController.New(db, config)
	sseC.Start()
	mux.Handle("/events",
		handlers.LoggingHandler(
			os.Stdout,
			http.HandlerFunc(sessionMiddleware(tokenSigningKey, sseC.HandleEvents, false)),
		),
	)

	return mux
}

func noTimeoutHandler(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var timeoutHandler http.Handler
		timeoutHandler = http.TimeoutHandler(h, 3600*time.Second, "")
		timeoutHandler.ServeHTTP(w, r)
	}
}
