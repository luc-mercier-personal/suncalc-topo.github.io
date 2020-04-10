//to be refactored soon, I promise!

$(document).ready(function() {

	var map, geocoder, location, 
		sunrise, daylength,
		marker, sunrisePolyline, sunsetPolyline, sunPolyline, sunInfoOverlay,
		geolocationInProgress,
		limitedUpdateResult = limitExecByInterval(updateResult, 40),
		date = new Date(),
        height = 0,  // Observer height above ground, in meters
		moreDetailed = false;

	(function init() {
		map = new google.maps.Map(document.getElementById("map"), {
			zoom: 8,
			mapTypeId: google.maps.MapTypeId.ROADMAP,
			scaleControl: true
		});
		google.maps.event.addListener(map, 'click', mapClickHandler);
		google.maps.event.addListener(map, 'zoom_changed', function() {
			saveLocationInCookies();
			updateAddressHash();
		});
				
		geocoder = new google.maps.Geocoder();
		
		var welcomeHidden = !!readCookie('suncalc_welcome_hidden');
		$('#welcome').dialog({
			position: [80, 110], 
			minHeight: 130, 
			width: 350, 
			autoOpen: !welcomeHidden,
			close: function() {
				createCookie('suncalc_welcome_hidden', 'true');
			}
		});
		$('#about-link').click(function() {
			$('#welcome').dialog('open');
			return false;
		});
		
		$('#now-link').click(function() {
			setDate(new Date());
			updateResult();
			updateAddressHash();
			return false;
		});
		
		$(document).focus();
		
		/* date box */
		
		$('#date').datepicker({
			duration: '', 
			dateFormat: 'dd M, yy'
		}).change(function() {
			updateResult();
			updateAddressHash();
		});

		
		/* location box */
		
		$('#location').focus(showLocationBox).keydown(genTabHandler(hideLocationBox, true)).keydown(goIfEnter);
     
        /* height box */
        $('#height').change(function() {
          updateResult();
          updateAddressHash();
        });
		
		if (!navigator.geolocation && google.gears && google.gears.factory && google.gears.factory.create) {
			navigator.geolocation = google.gears.factory.create('beta.geolocation');
		}
		
		var keydownHandler = genTabHandler(hideLocationBox);
		if (navigator.geolocation) {
			$('#detect-location').keydown(keydownHandler).focus(showLocationBox).click(detectLocationClickHandler);
		} else {
			$('#detect-location').hide();
			$('#go-location').keydown(keydownHandler).focus(showLocationBox);
		}
		
		$('#go-location').click(doSearch);
		
		$('#time-slider-2').slider({
			min: 0,
			max: 1440,
			slide: function(event, ui) {
				var hours = Math.floor(ui.value / 60),
					minutes = ui.value % 60;
				date.setHours(hours);
				date.setMinutes(minutes);
				updateResult(true);
			},
			stop: function(event, ui) {
				updateAddressHash();
			}
		});
		
		$.address.externalChange(onExternalAddressChange);
		
		if ($.address.pathNames().length != 3) {
			var lastView = getLastViewFromCookies();
			if (lastView) {
				setLocation(lastView.location, getLocationNameFromCookies(), null, lastView.zoom);
			} else if (google.loader.ClientLocation) {
				var cl = google.loader.ClientLocation,
					name = cl.address? (cl.address.city || cl.address.region) + ', ' + cl.address.country : null;
				setLocation(new google.maps.LatLng(cl.latitude, cl.longitude), name, null, 12);
			} else {
				setLocation(new google.maps.LatLng(51.508, -0.125), "London", new google.maps.LatLng(45, -10), 2);
			}
			setDate(date);
			updateResult();
			updateAddressHash();
		}
		
		$(document).mousedown(documentMousedownHandler);
		
		var scaleStr = '<table id="time-scale"><tr>';
		for (var i = 0; i < 24; i++) {
			scaleStr += '<td>' + i + '<span>:00</span></td>';
		}
		scaleStr += '</table></tr>';
		$('#time-scale-container').html(scaleStr);
		
		$('#more-detailed-link').click(function() {
			moreDetailed = !moreDetailed;
			$(this).html((moreDetailed ? "Less" : "More") + " detailed &raquo;");
			$('#before-sunrise, #after-sunset, #daylight')[moreDetailed ? 'show' : 'hide']();
			$('#dawn, #dusk, #transit')[moreDetailed ? 'hide' : 'show']();
			updateResult();
			return false;
		});
	})();
	
	function setLocation(locLatlng, name, mapLatlng, zoom) {
		location = locLatlng;
		mapLatlng = mapLatlng || locLatlng;
		map.setOptions({center: mapLatlng, zoom: zoom});
		if (name) {
			$('#location').val(name);
		} else {
			geocodeCurrentPoint();
		}
	}
	
	function padNum(num) {
		return (num < 10 ? '0' : '') + num;
	}
		
	function onExternalAddressChange(e) {
        // Support the absence of height to make URLs backward-compatible
		if (!e.pathNames || e.pathNames.length < 3 || e.pathNames.length > 4) { return; }
		var locationArr = e.pathNames[0].split(','),
			dateArr = e.pathNames[1].split('.'),
			timeArr = e.pathNames[2].split(':'),
            heightStr = (e.pathNames.length == 3) ? "0" : e.pathNames[3],
			latlng = new google.maps.LatLng(parseFloat(locationArr[0]), parseFloat(locationArr[1])),
			zoom = parseInt(locationArr[2]);
			date = new Date(dateArr[0], dateArr[1]-1, dateArr[2], timeArr[0], timeArr[1], 0, 0);
			
		setLocation(latlng, null, null, zoom);
		setDate(date);
        setHeight(parseInt(heightStr));
		updateResult();
	}
	
	function setDate(newDate) {
		date = newDate;
		$('#time-slider-2').slider('value', 60 * date.getHours() + date.getMinutes());
		$('#date').datepicker('setDate', new Date(date));
	}
    
    function setHeight(newHeight) {
      height = isNaN(newHeight) ? 0 : Math.round(newHeight);
      $('#height').val("" + height);
    }
	
	function updateAddressHash() {
		var locationStr = [formatCoord(location.lat()), formatCoord(location.lng()), map.getZoom()].join(','),
			dateStr = [date.getFullYear(), padNum(date.getMonth() + 1), padNum(date.getDate())].join('.'),
			timeStr = formatTime(date),
            heightStr = ("" + Math.round(height)),
			hash = [locationStr, dateStr, timeStr, heightStr].join('/');
		$.address.value(hash);
	}
	
	function formatTime(date, postfix) {
		if (isNaN(date)) { return '&nbsp;&nbsp;n/a&nbsp;&nbsp;'; }
	
		var hours = date.getHours(),
			minutes = date.getMinutes(),
			ap;
			
		if (postfix) {
			ap = (hours < 12 ? 'am' : 'pm');
			if (hours == 0) { hours = 12; }
			if (hours > 12) { hours -= 12; }
		} else {
			hours = (hours < 10 ? '0' + hours : '' + hours);
		}
		
		minutes = (minutes < 10 ? '0' + minutes : '' + minutes);
		
		return hours + ':' + minutes + (postfix ? ' ' + ap : '');
	}
	
	function mapClickHandler(event) {
		location = event.latLng;
		geocodeCurrentPoint();
		saveLocationInCookies();
		updateResult();
		updateAddressHash();
	}
	
	function documentMousedownHandler(event) {
		if($(event.target).not('#location-container, #location-container *').length > 0) {
			hideLocationBox();
		}
		if($(event.target).not('#time-container, #time-container *').length > 0) {
			hideTimeBox();
		}
	}
	
	function detectLocationClickHandler() {
		geolocationInProgress = true;
		navigator.geolocation.getCurrentPosition(gotCurrentPosition);
		$('#location').attr('readonly', true).val('...');
		hideLocationBox();
	}
	
	function geocodeCurrentPoint() {
		$('#location').attr('readonly', true).attr('value', '...');
		geocoder.geocode({latLng: location, language: 'en'}, function(results, status) {
			if ((status == google.maps.GeocoderStatus.OK) && results[0]) {
				var result = results[0];
				for (var i = 1; i < results.length; i++) {
					if ((results[i].types.length > 1) && (results[i].types[1] == 'political')) {
						result = results[i];
						break;
					}
				}
				$('#location').attr('value', result.formatted_address);
			} else {
				$('#location').attr('value', '?');
			}
			saveLocationNameInCookies();
			$('#location').attr('readonly', false);
		});
	}

	function hideLocationBox() {
		$('#location-container').removeClass('extended');
	}
	function showLocationBox() {
		$('#location-container').addClass('extended');
	}
	function hideTimeBox() {
		$('#time-container').removeClass('extended');
	}
	function showTimeBox() {
		$('#time-container').addClass('extended');
	}

	function genTabHandler(fn, backward) {
		return function(event) {
			if ((event.keyCode == 9) && 
					((backward && event.shiftKey) || (!backward && !event.shiftKey))) {
				fn();
			}
		}
	}
	function goIfEnter(event) {
		if (event.keyCode == 13) {
			$('#go-location').click();
		}
	}
	
	function gotCurrentPosition(position) {
		if (!geolocationInProgress) { return; }
		geolocationInProgress = false;
		var lngSpan = 360 * (position.coords.accuracy / 40075016);
		var latSpan = 180 * (position.coords.accuracy / 40007862);
		location = new google.maps.LatLng(position.coords.latitude, position.coords.longitude);
		var sw = new google.maps.LatLng(location.lat() - latSpan/2, location.lng() - lngSpan/2);
		var ne = new google.maps.LatLng(location.lat() + latSpan/2, location.lng() + lngSpan/2);
		geocodeCurrentPoint();
		updateResult();
		updateAddressHash();
		map.fitBounds(new google.maps.LatLngBounds(sw, ne));
		saveLocationInCookies();
	}
	
	function doSearch() {
		var value = $('#location').attr('value');
		geocoder.geocode({address: $('#location').attr('value')}, function(results, status) {
			if ((status == google.maps.GeocoderStatus.OK) && results[0]) {
				location = results[0].geometry.location;
				updateResult();
				updateAddressHash();
				map.fitBounds(results[0].geometry.viewport);
				saveLocationInCookies();
			}
			$('#location').attr('readonly', false).val(value);
			saveLocationNameInCookies();
		});
		$('#location').attr('readonly', true).attr('value', '...');
		hideLocationBox();
	}
	
	function updateResult(onlyTimeOrHeight) {
		var hours = date.getHours(),
			minutes = date.getMinutes();
		date = $('#date').datepicker('getDate');
		date.setHours(hours);
		date.setMinutes(minutes);
        setHeight(parseInt($('#height').val()));
		
		if (!sunInfoOverlay) {
			sunInfoOverlay = new SuncalcOverlay(map, location, date, height);
		} else {
			sunInfoOverlay.update(location, date, height);
		}
		
		if (onlyTimeOrHeight !== true) {
			if (!marker) {
				marker = new google.maps.Marker({
					map: map,
					position: location,
					draggable: true
				});
				google.maps.event.addListener(marker, 'drag', function() {
					location = marker.getPosition();
					limitedUpdateResult();
				});
				google.maps.event.addListener(marker, 'dragend', function() {
					geocodeCurrentPoint();
					updateAddressHash();
					saveLocationInCookies();
				});
			} else {
				marker.setPosition(location);
			}
			
			var di = SunCalc.getDayInfo(date, location.lat(), location.lng(), moreDetailed);
			
			var transitAltitude = SunCalc.getSunPosition(di.transit, location.lat(), location.lng()).altitude;
			
			drawTimeInterval($('#time-scale-twilight'), $('#time-scale-twilight-2'), di.dawn, di.dusk, transitAltitude);
			drawTimeInterval($('#time-scale-sunlight'), $('#time-scale-sunlight-2'), di.sunrise.start, di.sunset.end, transitAltitude);
			
			if (moreDetailed) {
				var mi = di.morningTwilight;
				$('.morning-dark-time').html('00:00&mdash;'+formatTime(mi.astronomical.start));
				$('.morning-astro-time').html(formatTime(mi.astronomical.start)+'&mdash;'+formatTime(mi.astronomical.end));
				$('.morning-nau-time').html(formatTime(mi.nautical.start)+'&mdash;'+formatTime(mi.nautical.end));
				$('.morning-civil-time').html(formatTime(mi.civil.start)+'&mdash;'+formatTime(mi.civil.end));
				
				$('.sunrise-time').html(formatTime(di.sunrise.start)+'&mdash;'+formatTime(di.sunrise.end));
				$('.daylight-time').html(formatTime(di.sunrise.end)+'&mdash;'+formatTime(di.sunset.start));
				$('.sunset-time').html(formatTime(di.sunset.start)+'&mdash;'+formatTime(di.sunset.end));

				var ni = di.nightTwilight;
				$('.night-civil-time').html(formatTime(ni.civil.start)+'&mdash;'+formatTime(ni.civil.end));
				$('.night-nau-time').html(formatTime(ni.nautical.start)+'&mdash;'+formatTime(ni.nautical.end));
				$('.night-astro-time').html(formatTime(ni.astronomical.start)+'&mdash;'+formatTime(ni.astronomical.end));
				$('.night-dark-time').html(formatTime(ni.astronomical.end)+'&mdash;00:00');
			} else {
				$('.dawn-time').html(formatTime(di.dawn));
				$('.sunrise-time').html(formatTime(di.sunrise.start));
				$('.transit-time').html(formatTime(di.transit));
				$('.sunset-time').html(formatTime(di.sunset.end));
				$('.dusk-time').html(formatTime(di.dusk));
			}
		}
		
		//limitedUpdateAddressHash();
	}
	
	function getTimePercent(date) {
		return (date.getHours()*60 + date.getMinutes())*100/1440;
	}
	
	function drawTimeInterval(obj1, obj2, date1, date2, transitAltitude) {
		var x1 = getTimePercent(date1),
			x2 = getTimePercent(date2);
		
		if (isNaN(date1) || isNaN(date2)) {
			if (transitAltitude >= 0) {
				obj1.show().css({left: 0, right: 0});
				obj2.hide();
			} else {
				obj1.hide();
				obj2.hide();
			}
		} else if (x1 <= x2) {
			obj1.show().css({
				left: x1 + '%',
				right: (100 - x2) + '%'
			});
			obj2.hide();
		} else {
			obj1.show().css({
				left: x1 + '%',
				right: 0
			});
			obj2.show().css({
				left: 0,
				right: (100 - x2) + '%'
			});
		}
	}
	
	function formatCoord(n) {
		return Math.round(n * 10000) / 10000;
	}
			
	function saveLocationInCookies() {
		createCookie("suncalc_last_location", location.lat() + ':' + location.lng() + ':' + map.getZoom());
	}
	
	function saveLocationNameInCookies() {
		createCookie("suncalc_last_location_name", $('#location').val());
	}
	
	function getLastViewFromCookies() {
		var cookie = readCookie("suncalc_last_location");
		if (!cookie) { return null; }
		var values = cookie.split(":");
		return {
			location: new google.maps.LatLng(values[0], values[1]),
			zoom: parseInt(values[2])
		}
	}
	
	function getLocationNameFromCookies() {
		return readCookie("suncalc_last_location_name");
	}
		
	function limitExecByInterval(fn, time, context) {	
		var lock, execOnUnlock, args;
		return function() {
			args = arguments;
			if (!lock) {				
				lock = true;
				setTimeout(function(){
					lock = false;
					if (execOnUnlock) {
						args.callee.apply(context, args);
						execOnUnlock = false;
					}
				}, time);
				fn.apply(context, args);
			} else {
				execOnUnlock = true;
			}
		};
	}
	
	//taken from http://quirksmode.org/js/cookies.html
	function createCookie(name, value) {
		document.cookie = name + "=" + value + "; path=/";
	}

	function readCookie(name) {
		var nameEQ = name + "=";
		var ca = document.cookie.split(';');
		for(var i = 0; i < ca.length; i++) {
			var c = ca[i];
			while (c.charAt(0) == ' ') { c = c.substring(1, c.length); }
			if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
		}
		return null;
	}
});