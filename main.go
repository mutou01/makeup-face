package main

import (
	"embed"
	"io/fs"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var frontend embed.FS

func main() {
	assets, err := fs.Sub(frontend, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}
	preview := &PhotoPreviewService{}
	providerService := &ProviderService{store: desktopProviderStore(), client: desktopProviderClient()}
	fixtureAssets, faceFixture := desktopFaceFixture()
	faceService := &FaceService{store: desktopFaceStore(), client: desktopProviderClient(), preview: preview, fixture: faceFixture}
	app := application.New(application.Options{
		Name:        "MakeupMirror",
		Description: "本机妆容工作台",
		Assets: application.AssetOptions{
			Handler:        application.BundledAssetFileServer(assets),
			Middleware:     application.ChainMiddleware(preview.assets, fixtureAssets),
			DisableLogging: true,
		},
		Services: []application.Service{application.NewService(preview), application.NewService(providerService), application.NewService(faceService)},
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
