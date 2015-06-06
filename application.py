#!/usr/bin/python
import urllib
import urllib2
import cgi
import re
import math
import json
import datetime
import time
import sys
import calendar
import pytz
import ephem
from datetime import datetime, timedelta, date


def safe_float(s, dv):
    r = dv
    try:
        r = float(s)
    except:
        return dv
    return r


def safe_int(s, dv):
    r = dv
    try:
        r = int(s)
    except:
        return dv
    return r


def isInt(s):
    try:
        _v = int(s)
    except:
        return 0
    return 1


def isFloat(s):
    try:
        _f = float(s)
    except:
        return 0
    return 1


def F2C(temp):
    return (temp - 32) * 5 / 9


def C2F(temp):
    return temp * 9 / 5 + 32


def mm2in(x):
    return x * 0.03937008


def ft2m(x):
    return x * 0.3048


def IP2Int(ip):
    o = map(int, ip.split('.'))
    res = (16777216 * o[0]) + (65536 * o[1]) + (256 * o[2]) + o[3]
    return res


def getClientAddress(environ):
    try:
        return environ['HTTP_X_FORWARDED_FOR'].split(',')[-1].strip()
    except KeyError:
        return environ['REMOTE_ADDR']


def computeETs(latitude, longitude, elevation, temp_high, temp_low, temp_avg, hum_high, hum_low, hum_avg, wind, solar):
    tm = time.gmtime()
    dayofyear = tm.tm_yday

    latitude = safe_float(latitude, 0)
    longitude = safe_float(longitude, 0)

    # Converted values
    El = ft2m(elevation)
    Rs = float(solar) * 0.0864  # W/m2 to MJ/d /m2
    Tx = F2C(float(temp_high))
    Tn = F2C(float(temp_low))
    Tm = F2C(float(temp_avg))
    RHx = float(hum_high)
    RHn = float(hum_low)
    RHm = float(hum_avg)
    Td = Tm - (100 - RHm) / 5  # approx. dewpoint (daily mean)
    U2 = float(wind) * 0.44704  # wind speed in m/s

    # Step 1: Extraterrestrial radiation

    Gsc = 0.082
    sigma = 4.90e-9
    phi = math.pi * latitude / 180
    dr = 1 + 0.033 * math.cos(2 * math.pi * dayofyear / 365)
    delta = 0.409 * math.sin(2 * math.pi * dayofyear / 365 - 1.39)
    omegas = math.acos(-math.tan(phi) * math.tan(delta))
    Ra = (24 * 60 / math.pi) * Gsc * dr * (omegas * math.sin(delta)
                                           * math.sin(phi) + math.cos(phi) * math.cos(delta) * math.sin(omegas))

    # Step 2: Daily net radiation

    Rso = Ra * (0.75 + 2.0e-5 * El)  # 5
    Rns = (1 - 0.23) * Rs
    f = 1.35 * Rs / Rso - 0.35  # 7

    esTx = 0.6108 * math.exp(17.27 * Tx / (Tx + 237.3))  # 8
    esTn = 0.6108 * math.exp(17.27 * Tn / (Tn + 237.3))
    ed = (esTx * RHn / 100 + esTn * RHx / 100) / 2  # 10
    ea = (esTx + esTn) / 2  # 22

    epsilonp = 0.34 - 0.14 * math.sqrt(ea)  # 12
    Rnl = -f * epsilonp * sigma * \
        ((Tx + 273.14) ** 4 + (Tn + 273.15) ** 4) / 2  # 13
    Rn = Rns + Rnl

    # Step 3: variables needed to compute ET

    beta = 101.3 * ((293 - 0.0065 * El) / 293) ** 5.26  # 15
    lam = 2.45
    gamma = 0.00163 * beta / lam
    e0 = 0.6108 * math.exp(17.27 * Tm / (Tm + 237.3))  # 19
    Delta = 4099 * e0 / (Tm + 237.3) ** 2  # 20
    G = 0
    ea = (esTx + esTn) / 2

    # Step 4: calculate ETh

    ETh = 0.408 * (0.0023 * Ra * (Tm + 17.8) * math.sqrt(Tx - Tn))  # 23

    # Step 5: calculate ET0

    R0 = 0.408 * Delta * (Rn - G) / (Delta + gamma * (1 + 0.34 * U2))  # 24
    A0 = (900 * gamma / (Tm + 273)) * U2 * (ea - ed) / \
        (Delta + gamma * (1 + 0.34 * U2))  # 25
    ET0 = R0 + A0

    # Step 6: calculate ETr

    Rr = 0.408 * Delta * (Rn - G) / (Delta + gamma * (1 + 0.38 * U2))  # 27
    Ar = (1600 * gamma / (Tm + 273)) * U2 * (ea - ed) / \
        (Delta + gamma * (1 + 0.38 * U2))  # 28
    ETr = Rr + Ar

    return (mm2in(ETh), mm2in(ET0), mm2in(ETr))


def not_found(environ, start_response):
    """Called if no URL matches."""
    start_response('404 NOT FOUND', [('Content-Type', 'text/plain')])
    return ['Not Found']


def application(environ, start_response):
    path = environ.get('PATH_INFO')
    uwt = re.match('/weather(\d+)\.py', path)
    parameters = cgi.parse_qs(environ.get('QUERY_STRING', ''))
    status = '200 OK'
    wto = {}

    if uwt is not None:
        uwt = safe_int(uwt.group(1), 0)
    else:
        return not_found(environ, start_response)

    if 'loc' in parameters:
        loc = parameters['loc'][0]
    else:
        loc = ''

    if 'key' in parameters:
        key = parameters['key'][0]
    else:
        key = ''

    if 'format' in parameters:
        of = parameters['format'][0]
    else:
        of = ''

    if 'fwv' in parameters:
        fwv = parameters['fwv'][0]
    else:
        fwv = ''

    if 'wto' in parameters:
        wto = json.loads('{' + parameters['wto'][0] + '}')

    solar, wind, avehumidity, minhumidity, maxhumidity, maxt, mint, elevation, restrict, maxh, minh, meant, pre, pre_today, h_today, sunrise, sunset, scale, toffset = [
        0, 0, 0, 0, 0, 0, 0, 0, 0, -1, -1, -500, -1, -1, -1, -1, -1, -1, -1]
    ET = [0, 0, 0]
    eip = IP2Int(getClientAddress(environ))

    # if loc is GPS coordinate itself
    sp = loc.split(',', 1)
    if len(sp) == 2 and isFloat(sp[0]) and isFloat(sp[1]):
        lat = sp[0]
        lon = sp[1]
    else:
        lat = None
        lon = None

    # if loc is US 5+4 zip code, strip the last 4
    sp = loc.split('-', 1)
    if len(sp) == 2 and isInt(sp[0]) and len(sp[0]) == 5 and isInt(sp[1]) and len(sp[1]) == 4:
        loc = sp[0]

    tzone = None
    # if loc is pws, query wunderground geolookup to get GPS coordinates
    if loc.startswith('pws:') or loc.startswith('icao:'):
        try:
            req = urllib2.urlopen('http://api.wunderground.com/api/' +
                                  key + '/conditions/forecast/q/' + urllib.quote(loc) + '.json')
            dat = json.load(req)
            if 'current_observation' in dat:
                v = dat['current_observation'][
                    'observation_location']['latitude']
                if v and isFloat(v):
                    lat = v
                v = dat['current_observation'][
                    'observation_location']['longitude']
                if v and isFloat(v):
                    lon = v
                v = dat['current_observation'][
                    'observation_location']['elevation']
                if v:
                    elevation = safe_int(int(v.split()[0]), 0)
                v = dat['current_observation']['solarradiation']
                if v:
                    solar = safe_int(v, 0)
                v = dat['current_observation']['local_tz_long']
                if v:
                    tzone = v
                else:
                    v = dat['current_observation']['local_tz_short']
                    if v:
                        tzone = v

            forecast = dat['forecast']['simpleforecast']['forecastday'][0]

            v = forecast['high']['fahrenheit']
            if v:
                maxt = safe_int(v, 0)
            v = forecast['low']['fahrenheit']
            if v:
                mint = safe_int(v, 0)
            v = forecast['avehumidity']
            if v:
                avehumidity = safe_int(v, 0)
            v = forecast['maxhumidity']
            if v:
                maxhumidity = safe_int(v, 0)
            v = forecast['minhumidity']
            if v:
                minhumidity = safe_int(v, 0)
            v = forecast['avewind']['mph']
            if v:
                wind = safe_int(v, 0)

        except:
            lat = None
            lon = None
            tzone = None

    # now do autocomplete lookup to get GPS coordinates
    if lat == None or lon == None:
        try:
            req = urllib2.urlopen(
                'http://autocomplete.wunderground.com/aq?h=0&query=' + urllib.quote(loc))
            dat = json.load(req)
            if dat['RESULTS']:
                v = dat['RESULTS'][0]['lat']
                if v and isFloat(v):
                    lat = v
                v = dat['RESULTS'][0]['lon']
                if v and isFloat(v):
                    lon = v
                v = dat['RESULTS'][0]['tz']
                if v:
                    tzone = v
                else:
                    v = dat['RESULTS'][0]['tz_long']
                    if v:
                        tzone = v

        except:
            lat = None
            lon = None
            tzone = None

    if (lat) and (lon):
        if not loc.startswith('pws:') and not loc.startswith('icao:'):
            loc = '' + lat + ',' + lon

        home = ephem.Observer()

        home.lat = lat
        home.long = lon

        sun = ephem.Sun()
        sun.compute(home)

        sunrise = calendar.timegm(
            home.next_rising(sun).datetime().utctimetuple())
        sunset = calendar.timegm(
            home.next_setting(sun).datetime().utctimetuple())

    if tzone:
        try:
            tnow = pytz.utc.localize(datetime.utcnow())
            tdelta = tnow.astimezone(pytz.timezone(tzone)).utcoffset()
            toffset = tdelta.days * 96 + tdelta.seconds / 900 + 48
        except:
            toffset = -1

    if (key != ''):
        try:
            req = urllib2.urlopen('http://api.wunderground.com/api/' +
                                  key + '/yesterday/conditions/q/' + urllib.quote(loc) + '.json')
            dat = json.load(req)

            if dat['history'] and dat['history']['dailysummary']:
                info = dat['history']['dailysummary'][0]
                if info:
                    v = info['maxhumidity']
                    if v:
                        maxh = safe_float(v, maxh)
                    v = info['minhumidity']
                    if v:
                        minh = safe_float(v, minh)
                    v = info['meantempi']
                    if v:
                        meant = safe_float(v, meant)
                    v = info['precipi']
                    if v:
                        pre = safe_float(v, pre)
            info = dat['current_observation']
            if info:
                v = info['precip_today_in']
                if v:
                    pre_today = safe_float(v, pre_today)
                v = info['relative_humidity'].replace('%', '')
                if v:
                    h_today = safe_float(v, h_today)

            # Check which weather method is being used
            if ((uwt & ~(1 << 7)) == 1):
                # calculate water time scale, per
                # https://github.com/rszimm/sprinklers_pi/blob/master/Weather.cpp
                hf = 0
                if (maxh >= 0) and (minh >= 0):
                    hf = 30 - (maxh + minh) / 2
                # elif (h_today>=0):
                #  hf = 30 - h_today
                tf = 0
                if (meant > -500):
                    tf = (meant - 70) * 4
                rf = 0
                if (pre >= 0):
                    rf -= pre * 200
                if (pre_today >= 0):
                    rf -= pre_today * 200

                if 'temp' in wto:
                    tf = tf * (wto['temp'] / 100.0)

                if 'humidity' in wto:
                    hf = hf * (wto['humidity'] / 100.0)

                if 'rain' in wto:
                    rf = rf * (wto['rain'] / 100.0)

                scale = (int)(100 + hf + tf + rf)

                if (scale < 0):
                    scale = 0
                if (scale > 200):
                    scale = 200

            elif ((uwt & ~(1 << 7)) == 2):
                ET = computeETs(lat, lon, elevation, maxt, mint, meant,
                                maxhumidity, minhumidity, avehumidity, wind, solar)
                # TODO: Actually generate correct scale using ET (ET[1] is ET0
                # for short canopy)
                scale = safe_int(ET[1] * 100, -1)

            # Check weather modifier bits and apply scale modification
            if ((uwt >> 7) & 1):
                # California modification to prevent watering when rain has
                # occured within 48 hours

                # Get before yesterday's weather data
                beforeYesterday = date.today() - timedelta(2)

                req = urllib2.urlopen('http://api.wunderground.com/api/' + key + '/history_' +
                                      beforeYesterday.strftime('%Y%m%d') + '/q/' + urllib.quote(loc) + '.json')
                dat = json.load(req)

                if dat['history'] and dat['history']['dailysummary']:
                    info = dat['history']['dailysummary'][0]
                    if info:
                        v = info['precipi']
                        if v:
                            pre_beforeYesterday = safe_float(v, -1)

                preTotal = pre_today + pre + pre_beforeYesterday

                if (preTotal > 0.01):
                    restrict = 1
        except:
            pass

        urllib2.urlopen('https://ssl.google-analytics.com/collect?v=1&t=event&ec=weather&ea=lookup&el=results&ev=' + str(scale) +
                        '&cd1=' + str(fwv) + '&cd2=' + urllib.quote(loc) + '&cd3=' + str(toffset) + '&cid=555&tid=UA-57507808-1&z=' + str(time.time()))
    else:
        urllib2.urlopen('https://ssl.google-analytics.com/collect?v=1&t=event&ec=timezone&ea=lookup&el=results&ev=' + str(
            toffset) + '&cd1=' + str(fwv) + '&cd2=' + urllib.quote(loc) + '&cid=555&tid=UA-57507808-1&z=' + str(time.time()))

    # prepare sunrise sunset time
    delta = 3600 / 4 * (toffset - 48)
    if (sunrise >= 0):
        sunrise = int(((sunrise + delta) % 86400) / 60)
    if (sunset >= 0):
        sunset = int(((sunset + delta) % 86400) / 60)

    if of == 'json' or of == 'JSON':
        output = '{"scale":%d, "restrict":%d, "tz":%d, "sunrise":%d, "sunset":%d, "maxh":%d, "minh":%d, "meant":%d, "pre":%f, "prec":%f, "hc":%d, "eip":%d}' % (
            scale, restrict, toffset, sunrise, sunset, int(maxh), int(minh), int(meant), pre, pre_today, int(h_today), eip)
    else:
        output = '&scale=%d&restrict=%d&tz=%d&sunrise=%d&sunset=%d&maxh=%d&minh=%d&meant=%d&pre=%f&prec=%f&hc=%d&eip=%d' % (
            scale, restrict, toffset, sunrise, sunset, int(maxh), int(minh), int(meant), pre, pre_today, int(h_today), eip)

    response_headers = [
        ('Content-type', 'text/plain'), ('Content-Length', str(len(output)))]
    start_response(status, response_headers)

    return [output]
