package facemesh

import "math"

const Topology = "mediapipe-478-v1"

type Point struct {
	X *float64 `json:"x"`
	Y *float64 `json:"y"`
}

type Pose struct {
	Rows    int       `json:"rows"`
	Columns int       `json:"columns"`
	Data    []float64 `json:"data"`
}

type Face struct {
	Points []Point `json:"points"`
	Pose   Pose    `json:"pose"`
}

type Result struct {
	Topology string `json:"topology"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Faces    []Face `json:"faces"`
}

func (r Result) Valid() bool {
	if r.Topology != Topology || r.Width < 1 || r.Height < 1 || max(r.Width, r.Height) > 1024 || r.Faces == nil || len(r.Faces) > 2 {
		return false
	}
	for _, face := range r.Faces {
		if len(face.Points) != 478 || face.Pose.Rows != 4 || face.Pose.Columns != 4 || len(face.Pose.Data) != 16 {
			return false
		}
		for _, point := range face.Points {
			if !coordinate(point.X) || !coordinate(point.Y) {
				return false
			}
		}
		for _, value := range face.Pose.Data {
			if math.IsNaN(value) || math.IsInf(value, 0) {
				return false
			}
		}
		if math.Hypot(math.Hypot(face.Pose.Data[8], face.Pose.Data[9]), face.Pose.Data[10]) < 1e-6 {
			return false
		}
	}
	return true
}

func coordinate(value *float64) bool {
	return value != nil && *value >= 0 && *value <= 1
}
