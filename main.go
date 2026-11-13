package main

import (
	"embed"
	"io/fs"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
	"makeupmirror/internal/diagnostics"
)

//go:embed all:frontend/dist
var frontend embed.FS

func main() {
	assets, err := fs.Sub(frontend, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}
	diagnosticSession := &diagnostics.Session{}
	preview := &PhotoPreviewService{diagnostics: diagnosticSession}
	diagnosticsService := &DiagnosticsService{session: diagnosticSession}
	providerService := &ProviderService{store: desktopProviderStore(), client: desktopProviderClient()}
	fixtureAssets, faceFixture := desktopFaceFixture()
	faceService := &FaceService{store: desktopFaceStore(), client: desktopProviderClient(), preview: preview, fixture: faceFixture}
	imageService := &ImageService{store: desktopImageStore(), client: desktopProviderClient(), preview: preview}
	app := application.New(application.Options{
		Name:        "MakeupMirror",
		Description: "本机妆容工作台",
		Assets: application.AssetOptions{
			Handler:        application.BundledAssetFileServer(assets),
			Middleware:     application.ChainMiddleware(preview.assets, fixtureAssets),
			DisableLogging: true,
		},
		Services: []application.Service{application.NewService(preview), application.NewService(providerService), application.NewService(faceService), application.NewService(imageService), application.NewService(diagnosticsService)},
		Windows:  desktopOptions(),
	})
	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "MakeupMirror",
		URL:       "/",
		Width:     840,
		Height:    620,
		MinWidth:  520,
		MinHeight: 420,
	})
	preview.pick = desktopPhotoPicker(window)
	preview.pickProject = desktopProjectPicker(window)
	preview.pickExport = desktopExportPicker(window)
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
