var SuncalcOverlay = function(map, position, date, height) {
	this.setMap(map);
	this.update(position, date, height);
};

SuncalcOverlay.prototype = new google.maps.OverlayView();

// Constructor for a manager of the rays of elevation, that takes care of:
// - calling the elevation service
// - compute topographical angles
// - interpolate those angles
function ElevationRayManager(overlay, position) {
    this._overlay = overlay;
    this._elevationService = new google.maps.ElevationService();
    this._position = position;
    this.NUM_RAYS = 24; // In how many directions we compute the elevations
    // How far do we look for obstruction ? 5 km.
    this.SHADE_COMPUTATION_DISTANCE = 5000;
    this.SHADE_COMPUTATION_NUM_SAMPLES = 50; // 1 point every 100 m
    // _elevations[i] = the elevations in heading 360*i/NUM_RAYS degrees (from north, clockwise)
    this._elevations = Array(this.NUM_RAYS).fill().map(() => []);
    this._centerElevation = null; // Elevation at _position
    
    this._pendingCallbacks = Array(this.NUM_RAYS).fill()
    .map((_,i)=>i).map(this._createSendRPCCallback, this) 

    // We differ the initialization by 100 ms. This is because when dragging, the location changes a lot,
    // which can cause many unnecessary RPCs to the elevation service, which are costly.
    setTimeout(this._finishInit.bind(this), 100);
};

//Is this object still the current manager?
ElevationRayManager.prototype._isUpToDate = function() {
	return this._overlay.elevationManager == this;
};

//Is this manager ready to be used?
ElevationRayManager.prototype.isInitialized = function() {
	return this._pendingCallbacks.length == 0;
};

ElevationRayManager.prototype._finishInit = function() {
	// Is this still the most current ElevationRayManager ?
	if (!this._isUpToDate()) {
		return;
	}
	if (this.isInitialized()) {
		console.log("All elevations received: !");
		// Init is done. Now we can plot
		this._overlay.plotSunAndShade();
	} else {
		// We send the elevation services sequentially. This looks certainly
		// weird, but this way we get way fewer OUT_OF_QUOTA responses.
		var callback = this._pendingCallbacks.pop();
		callback();
	}
};

ElevationRayManager.prototype._createSendRPCCallback = function(index) {
    var self = this;
    return function() {
        var heading = 360*index/self.NUM_RAYS;
        var destination = google.maps.geometry.spherical.computeOffset(self._position, self.SHADE_COMPUTATION_DISTANCE, heading);
        var straightPath = [ self._position, destination];
        self._elevationService.getElevationAlongPath(
        		{
        			path: straightPath,
        			samples: self.SHADE_COMPUTATION_NUM_SAMPLES
        		},
        		((result, status) => { self._processElevationResponseCallback(index, result, status);}
        		).bind(self));
    };
};
            
ElevationRayManager.prototype._processElevationResponseCallback = function(index, result, status){
	// Is this still the most current ElevationRayManager ?
	if (!this._isUpToDate()) {
		return;
	}
	if (status != google.maps.ElevationStatus.OK) {
		this._overlay.waitAfterFailedRpc = Math.ceil(1.5 * this._overlay.waitAfterFailedRpc );
		console.log("Elevation status is " + status + ". Increased wait to " + this._overlay.waitAfterFailedRpc + "ms.");
		// Enqueue back RPC
		this._pendingCallbacks.push(this._createSendRPCCallback(index));
		//      setTimeout(this._createSendRPCCallback(index), this._overlay.waitAfterFailedRpc);
		setTimeout(this._finishInit.bind(this), this._overlay.waitAfterFailedRpc);
		return;
	} 
	// The RPC worked. Reset the wait.
	this._overlay.waitAfterFailedRpc = 100;
	if (result.length != this.SHADE_COMPUTATION_NUM_SAMPLES) {
		console.log("Unexpected number of elevations points: expected " + this.SHADE_COMPUTATION_NUM_SAMPLES + ", received " + result.length);
		return;
	}
	this._centerElevation = result[0].elevation;
	this._elevations[index] = result.slice(1, this.SHADE_COMPUTATION_NUM_SAMPLES);
	this._finishInit();
};

ElevationRayManager.prototype._maxAngle = function(index, height) {
  var centerElevation = this._centerElevation;
  var distanceIncrement = this.SHADE_COMPUTATION_DISTANCE / this.SHADE_COMPUTATION_NUM_SAMPLES;
  var angles = this._elevations[index].map(function (r, i){return Math.atan( (r.elevation - (centerElevation + height)) / ((i+1) * distanceIncrement))});
  return Math.max.apply(null, angles);
};

// Returns the angle of the landscape seen from the observer at the given azimuth. The azimuth is a
// SunCalc's azimuth: south in 0, west is Pi/2.
//
// height is the observer height above ground, in meters.
ElevationRayManager.prototype.getTopographicalAngle = function(azimuth, height) {
	if (this._pendingCallbacks.length != 0) {
		console.log("Illegal state: cannot compute angles while results are pending.");
		return;
	}
	var heading = 180 + azimuth * 180 / Math.PI;
	if (heading < 0) {
		heading += 360;
	}
	if (heading >= 360) {
		heading -= 360;
	}
	var increment = 360 / this.NUM_RAYS;
	var lowerBoundIndex = Math.floor(heading / increment);
  var excess = heading - lowerBoundIndex * increment;
  var interpolationFraction = excess / increment;
  var upperBoundIndex = (lowerBoundIndex + 1) % this.NUM_RAYS;
  var interpolated = this._maxAngle(lowerBoundIndex, height) * (1 - interpolationFraction) + this._maxAngle(upperBoundIndex, height) * interpolationFraction;
  return interpolated;
};
            
$.extend(SuncalcOverlay.prototype, {
	RADIUS: 270,
	PADDING: 10,
	CURVE_TIME_INTERVAL: 1000*60*20,      // 20 min
    SUN_SHADE_RAYS_INTERVAL: 1000*60*10,  // 10 min
    	
	CIRCLE_ATTRS: 			["#000000", 0.5, 1],
	
	GREY_PATH_ATTRS: 		["#000000", 0.4, 1],
	
	SUNRISE_DIR_ATTRS: 		['#ffd700', 0.9, 6],
	SUNRISE_SECTOR_ATTRS: 	['#ffd700', 0.15],
	
	SUNSET_DIR_ATTRS: 		['#ff4500', 0.6, 6],
	SUNSET_SECTOR_ATTRS: 	['#ff4500', 0.12],
	
	//SUNLIGHT_FILL_ATTRS:	['#ffd700', 0.2],
         SUNNY_ATTRS: ['#ffd700', 0.2, 4],
         SHADY_ATTRS:    ['#000000', 0.2, 4],
	
	CURRENT_CURVE_ATTRS: 	['#ffa500', 0.7, 4],
	SUN_DIR_ATTRS: 			['#ffa500', 0.9, 7],
	
	EDGE_SUNRISE_DIR_ATTRS: ['#ffd700', 0.9, 1],
	EDGE_SUNSET_DIR_ATTRS: 	['#ff4500', 0.7, 1],
         
    

	update: function(position, date, height) {
		if (this._position != position) {
			this._positionChanged = true;
			this._position = position;
		}
		if (this._date != date) {
			if (this._date && (this._date.getFullYear() == date.getFullYear()) &&
					(this._date.getDate() == date.getDate()) &&
					(this._date.getMonth() == date.getMonth())) {
				this._timeChanged = true;
			} else {
				this._dayChanged = true;
			}
			this._date = date;
		}
        if (this._height != height) {
         this._heightChanged = true;
         this._height = height;
        }
		
		if (this._initialized && (this._positionChanged || this._dayChanged || this._timeChanged || this._heightChanged)) {
			this.draw();
		}
	},
	
	onAdd: function() {
		// Default wait of 100 ms after a failed RPC to the elevation service
        this.waitAfterFailedRpc = 100;
        this.lastRpcFailed = false;
        
		this._centerX = this._centerY = this.RADIUS + this.PADDING;
		this._width = this._centerX * 2;
		this._height = this._centerY * 2;
		
		this._container = document.createElement('div');
		this._container.style.position = 'absolute';
		
		this._paper = Raphael(this._container, this._width, this._height);
		
		//background circle
		this._circle = this._paper.circle(this._centerX, this._centerY, this.RADIUS);
		this._circle.attr(this._genPathAttrs(this.CIRCLE_ATTRS));
		
		//sunlight area
		//this._sunlightFill = this._paper.path().attr(this._genFillAttrs(this.SUNLIGHT_FILL_ATTRS));
		
		//June 21
		this._jun21Curve = this._paper.path().attr(this._genPathAttrs(this.GREY_PATH_ATTRS));
		
		//December 21
		this._dec21Curve = this._paper.path().attr(this._genPathAttrs(this.GREY_PATH_ATTRS));
		
		//sunset/sunrise intervals
		this._sunriseSector = this._paper.path().attr(this._genFillAttrs(this.SUNRISE_SECTOR_ATTRS)).hide();
		this._sunsetSector = this._paper.path().attr(this._genFillAttrs(this.SUNSET_SECTOR_ATTRS)).hide();
		
		//current day
		this._sunriseDir = this._paper.path().attr(this._genPathAttrs(this.SUNRISE_DIR_ATTRS));
		this._sunsetDir = this._paper.path().attr(this._genPathAttrs(this.SUNSET_DIR_ATTRS));
		this._sunDir = this._paper.path().attr(this._genPathAttrs(this.SUN_DIR_ATTRS));
		this._currentCurve = this._paper.path().attr(this._genPathAttrs(this.CURRENT_CURVE_ATTRS));
         
         // Elevation manager
         this.elevationManager = null;
         
         // Sunny/Shady rays
         this._rays = [];
		
		function bind(fn, obj) {
			return function() {
				return fn.apply(obj, arguments);
			}
		}
		
		this._sunriseDir.hover(bind(this._sunriseSector.show, this._sunriseSector), bind(this._sunriseSector.hide, this._sunriseSector));
		this._sunsetDir.hover(bind(this._sunsetSector.show, this._sunsetSector), bind(this._sunsetSector.hide, this._sunsetSector));
		
		this.getPanes().overlayLayer.appendChild(this._container);
		this._initialized = true;
	},
	
	draw: function() {
		var projection = this.getProjection();
		var pos = projection.fromLatLngToDivPixel(this._position);
		this._container.style.left = (pos.x - this._centerX) + 'px';
		this._container.style.top = (pos.y - this._centerY) + 'px';
		
        if (this._positionChanged || this._dayChanged || this._heightChanged) {
          // First of all, clear the outdated. sunny/shady rays.
          // We will re-add them, but because it is asynchronous, there may be some time before that...
          this._rays.map(function (r, _){r.attr('path', '');});
          this._rays = [];
        }
		if (this._positionChanged) {
            this.elevationManager = new ElevationRayManager(this, this._position);
			this._drawYearInfo();
			this._drawCurrentDayInfo();
			this._drawCurrentTimeInfo();
            // Try to draw the sun/shade rays. Maybe we can plot immediately.
            // If not, that means we'll receieve a callback to plot later.
            this.plotSunAndShade();
		} else if (this._dayChanged) {
			this._drawCurrentDayInfo();
			this._drawCurrentTimeInfo();
            // Try to draw the sun/shade rays. Maybe we can plot immediately.
            // If not, that means we'll receieve a callback to plot later.
            this.plotSunAndShade();
        } else {
          if (this._timeChanged) {
			this._drawCurrentTimeInfo();
		  }
          if (this._heightChanged) {
            // Try to draw the sun/shade rays. Maybe we can plot immediately.
            // If not, that means we'll receieve a callback to plot later.
            this.plotSunAndShade();
          }
        }
		this._positionChanged = this._dayChanged = this._timeChanged = this._heightChanged = false;
	},
	
	onRemove: function() {
		this.getPanes().overlayLayer.removeChild(this._container);
	},
	
	_drawYearInfo: function() {
		var jun21 = this._getLongestDay(),
			jun21di = this._getDayInfo(jun21),
			jun21CurvePath = this._getCurvePathStr(jun21di, jun21);
			
		this._jun21Curve.attr('path', jun21CurvePath);
		
		var dec21 = this._getShortestDay(),
			dec21di = this._getDayInfo(dec21),
			dec21CurvePath = this._getCurvePathStr(dec21di, dec21);
			
		this._dec21Curve.attr('path', dec21CurvePath);
		
		var sunriseSectorPath = this._getSectorPathStr(jun21di.sunrise.start, dec21di.sunrise.start);
		
		var sunlightFillPath = sunriseSectorPath ? this._getSunlightFillPath(jun21CurvePath, dec21CurvePath) : '';
		//this._sunlightFill.attr('path', sunlightFillPath);
		
		this._sunriseSector.attr('path', sunriseSectorPath);
		this._sunsetSector.attr('path', this._getSectorPathStr(dec21di.sunset.end, jun21di.sunset.end));
	},
	
	_drawCurrentDayInfo: function() {

		var di = this._getDayInfo(this._date);
		this._sunriseDir.attr('path', this._getPosPathStr(di.sunrise.start, false));
		this._sunsetDir.attr('path', this._getPosPathStr(di.sunset.end, false));
		this._currentCurve.attr('path', this._getCurvePathStr(di, this._date));
	},
	
	_drawCurrentTimeInfo: function() {
		this._sunDir.attr('path', this._getPosPathStr(this._date, true));
	},
	
	_getSunlightFillPath: function(jun21CurvePath, dec21CurvePath) {
		if (!jun21CurvePath || !dec21CurvePath) { return ''; }
	
		var r = this.RADIUS,
			path = dec21CurvePath.concat(['A', r, r, 0, 0, 1]);
		
		for (var start = jun21CurvePath.length - 3, i = start; i >= 0; i-= 3) {
			if (i != start) {
				path.push('L');
			}
			path.push(jun21CurvePath[i+1]);
			path.push(jun21CurvePath[i+2]);
		}
		
		path = path.concat(['A', r, r, 0, 0, 1, path[1], path[2]]);
		return path;
	},
	
	_getSectorPathStr: function(date1, date2) {
		var p1 = this._getSunPosPoint(date1),
			p2 = this._getSunPosPoint(date2),
			r = this.RADIUS;
		if (isNaN(p1.x) || isNaN(p2.x)) { return ''; }
			
		return ['M', this._centerX, this._centerY, 'L', p1.x, p1.y, 'A', r, r, 0, 0, 1, p2.x, p2.y, 'z'];
	},
	
	_getPosPathStr: function(date, acceptBelowHorizon) {
		var posPoint = this._getSunPosPoint(date);
		if (!acceptBelowHorizon && posPoint.altitude < -0.018) { return ''; }
			
		return ['M', this._centerX, this._centerY, 'L', posPoint.x, posPoint.y];
	},
         
    plotSunAndShade: function() {
      if (!this.elevationManager.isInitialized()) {
        // This can happen if the location changed recently: we got notified
        // that results are ready, but they are no longer valid.
        return;
      }
    
         // If the topo angles are negative (ie., we're on top of a mountain),
         // there may be sun after the "ellipsoidal model" sunset. So we plot
         // from midnight to midnight, not from sunrise to sunset.
         var start = this._precedingMidnight();
         var end = new Date(start).setDate(start.getDate() + 1);
         
         for (var date = new Date(start); date < end; date.setTime(date.valueOf() + this.SUN_SHADE_RAYS_INTERVAL)) {
           var posPoint = this._getSunPosPoint(date);
           var topoAngle = this.elevationManager.getTopographicalAngle(posPoint.azimuth, this._height);
           var isSunny = posPoint.altitude > topoAngle;
           var sunOrShade = this._paper.path().attr(this._genPathAttrs(isSunny ? this.SUNNY_ATTRS : this.SHADY_ATTRS));
           // When the sun is below the spherical horizon, there is no point in plotting the shady rays: it's just
           // visul polution. However, when it's sunny after sunset or before sunrise, that's valuable information
           // that needs to be plotted.
           sunOrShade.attr('path', this._getPosPathStr(date, isSunny));
           this._rays.push(sunOrShade);
         }
     },
         
         
         _precedingMidnight: function() {
         var date = new Date(this._date);
         date.setHours(0);
         date.setMinutes(0);
         date.setSeconds(0);
         date.setMilliseconds(0);
         return date;
         },
         
	
	_getCurvePathStr: function(di, date) {
		var dates = [];
		
		var start = isNaN(di.sunrise.start) ? date : di.sunrise.start,
			end = isNaN(di.sunset.end) ? new Date(date).setDate(date.getDate() + 1) : di.sunset.end;
         
		var date = new Date(start);
		while (date < end) {
			dates.push(new Date(date));
			date.setTime(date.valueOf() + this.CURVE_TIME_INTERVAL);
		}
		
		dates.push(end);

		var path = [],
			belowHorizon = true;
		for (var i = 0, len = dates.length; i < len; i++) {
			var posPoint = this._getSunPosPoint(dates[i]);
			belowHorizon = belowHorizon && (posPoint.altitude < 0);
			path.push(!i ? 'M' : 'L');
			path.push(posPoint.x);
			path.push(posPoint.y);
		}
		if (belowHorizon) { return ''; }
		return path;
	},
	
	_getDayInfo: function(date) {
		return SunCalc.getDayInfo(date, this._position.lat(), this._position.lng());
	},
	
	_getSunPosPoint: function(date) {
		var pos = SunCalc.getSunPosition(date, this._position.lat(), this._position.lng()),
			angle = Math.PI/2 + pos.azimuth,
           distanceRatio = (pos.altitude > 0) ? Math.cos(pos.altitude) : (2 - Math.cos(pos.altitude) );
		return {
			x: this._centerX + this.RADIUS * Math.cos(angle) * distanceRatio,
			y: this._centerY + this.RADIUS * Math.sin(angle) * distanceRatio,
			altitude: pos.altitude,
            azimuth: pos.azimuth
		};
	},
	
	_getShortestDay: function() {
		var date = new Date(this._date);
		date.setMonth(11);
		date.setDate(21);
		return date;
	},
	
	_getLongestDay: function() {
		var date = new Date(this._date);
		date.setMonth(5);
		date.setDate(21);
		return date;
	},
	
	_genPathAttrs: function(arr) {
		return {
			'stroke': arr[0], 
			'stroke-opacity': arr[1],
			'stroke-width': arr[2]
		};
	},
	
	_genFillAttrs: function(arr) {
		return {
			'fill': arr[0], 
			'fill-opacity': arr[1],
			'stroke': 'none'
		};
	}
});
